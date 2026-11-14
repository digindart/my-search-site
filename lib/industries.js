const categoriesFile = require('../data/industry-categories.json');
const companiesFile = require('../data/industry-companies.json');
const {needsReview} = require('./quality');

function validateCompanies(companies) {
  const stocks = new Map(); const identities = new Map();
  for (const c of companies) {
    if (!/^\d{8}$/.test(c.corp_code) || !categoriesFile.some(i=>i.code===c.industry_code)) throw new Error('Invalid company classification');
    if (c.stock_code && !/^\d{6}$/.test(c.stock_code)) throw new Error('Invalid stock code');
    if (c.stock_code && stocks.has(c.stock_code) && stocks.get(c.stock_code)!==c.corp_code) throw new Error('Ambiguous stock code');
    if(c.stock_code) stocks.set(c.stock_code,c.corp_code);
    if(!c.evidence?.source_url || !c.evidence?.basis || !c.evidence?.checked_on) throw new Error('Classification evidence is required');
    if(!['approved','pending','rejected'].includes(c.review_status) || !Number.isInteger(c.valid_from_year) || (c.valid_to_year!=null && (!Number.isInteger(c.valid_to_year)||c.valid_to_year<c.valid_from_year))) throw new Error('Invalid classification state or period');
    if(c.review_status==='approved' && c.is_primary) {
      const prior=identities.get(c.corp_code)||[];
      if(prior.some(p=>Math.max(p.valid_from_year,c.valid_from_year)<=Math.min(p.valid_to_year??9999,c.valid_to_year??9999))) throw new Error('Overlapping primary classifications');
      prior.push(c);identities.set(c.corp_code,prior);
    }
  }
  return companies;
}
validateCompanies(companiesFile.companies);
function parseIndustryQuery(query) {
  const result={};
  for(const [key,max] of [['name',100],['company',255],['position',255],['year',4],['page',7]]){
    const value=query[key];if(value!=null && typeof value!=='string')throw badRequest('검색 조건은 하나씩 입력해주세요.');
    result[key]=String(value||'').trim();if(result[key].length>max)throw badRequest('검색 조건이 너무 깁니다.');
  }
  if(result.year && !/^(19|20)\d{2}$/.test(result.year))throw badRequest('올바른 사업연도를 선택해주세요.');
  if(result.page && (!/^[1-9]\d*$/.test(result.page)||Number(result.page)>1000000))throw badRequest('올바른 페이지를 선택해주세요.');
  return {...result,page:Number(result.page||1)};
}
function badRequest(message){const e=new Error(message);e.status=400;return e;}
const normalize = s=>String(s??'').normalize('NFKC').toLocaleLowerCase('ko-KR');
function buildIndustryModel(category, members, inputRows, query) {
  const q=parseIndustryQuery(query);const approved=members.filter(c=>c.review_status==='approved');
  const active=(c,year)=>c.valid_from_year<=Number(year)&&(c.valid_to_year==null||c.valid_to_year>=Number(year));
  const scoped=inputRows.filter(r=>approved.some(c=>c.corp_code===r.corp_code&&active(c,r.fiscal_year)));
  const years=[...new Set(scoped.map(r=>Number(r.fiscal_year)))].sort((a,b)=>b-a);
  if(q.year && !years.includes(Number(q.year)))throw badRequest('이 업권에서 자료가 확인되는 연도를 선택해주세요.');
  const year=q.year?Number(q.year):years[0]??null;
  const memberMap=new Map(approved.filter(c=>year==null||active(c,year)).sort((a,b)=>a.valid_from_year-b.valid_from_year).map(c=>[c.corp_code,c]));
  let pending=0;const unique=new Map();
  for(const r of scoped.filter(r=>Number(r.fiscal_year)===year)){
    if(needsReview(r)){pending++;continue;}
    if(!r.employee_name || ['-','합계','계'].includes(r.employee_name) || r.compensation==null || BigInt(r.compensation)<=0n)continue;
    const row={...r,fiscal_year:Number(r.fiscal_year),compensation:String(r.compensation)};
    // A renamed company is one legal entity; its display alias is not an identity key.
    const key=JSON.stringify([row.corp_code,row.fiscal_year,row.employee_name,row.position_name,row.compensation]);
    if(!unique.has(key))unique.set(key,row);
  }
  const rows=[...unique.values()].sort((a,b)=>BigInt(a.compensation)!==BigInt(b.compensation)?(BigInt(a.compensation)>BigInt(b.compensation)?-1:1):a.corp_code.localeCompare(b.corp_code)||a.employee_name.localeCompare(b.employee_name,'ko')||a.position_name.localeCompare(b.position_name,'ko'));
  let rank=0;const ranked=rows.map((r,i)=>{if(!i||rows[i-1].compensation!==r.compensation)rank=i+1;return {...r,rank};});
  const filtered=ranked.filter(r=>normalize(r.employee_name).includes(normalize(q.name)) && normalize(r.position_name).includes(normalize(q.position)) && [r.company_name,memberMap.get(r.corp_code)?.display_name,memberMap.get(r.corp_code)?.legal_name,memberMap.get(r.corp_code)?.stock_code,r.corp_code].some(v=>normalize(v).includes(normalize(q.company))));
  const pageSize=20,totalPages=Math.max(1,Math.ceil(filtered.length/pageSize)),page=Math.min(q.page,totalPages);
  const companies=[...memberMap.values()].filter(c=>year==null || (c.valid_from_year<=year&&(c.valid_to_year==null||c.valid_to_year>=year))).map(c=>{const records=rows.filter(r=>r.corp_code===c.corp_code);return {...c,records:records.length,highest:records[0]?.compensation??null,reportedNames:[...new Set(records.map(r=>r.company_name))]};}).sort((a,b)=>a.display_name.localeCompare(b.display_name,'ko'));
  const dates=[...new Set(approved.map(c=>c.evidence?.checked_on).filter(Boolean))].sort();
  const classificationDate=dates.length>1?dates[0]+' ~ '+dates.at(-1):dates[0]||null;
  return {category,companies,years,year,classificationDate,query:{...q,page},top20:ranked.slice(0,20),totalDisclosures:rows.length,pending,filtered,total:filtered.length,page,pageSize,totalPages,results:filtered.slice((page-1)*pageSize,page*pageSize),noindex:!rows.length || !!(q.name||q.company||q.position||q.year||q.page>1)};
}

function createIndustryService(getDatabase,{ttl=15000}={}) {
  let catalogueCache;const rowsCache=new Map();
  async function catalogue(){
    if(catalogueCache && catalogueCache.until>Date.now())return catalogueCache.value;
    const db=getDatabase();let categories,companies,mode;
    try{[categories]=await db.execute('SELECT code,slug,name,parent_code,description,sort_order,page_enabled FROM industry_categories WHERE code <> ? ORDER BY sort_order',['FINANCE']);}
    catch(e){if(e.code!=='ER_NO_SUCH_TABLE')throw e;categories=categoriesFile;companies=companiesFile.companies;mode='reviewed-file';}
    if(!mode){
      const [records]=await db.execute('SELECT c.corp_code,c.stock_code,c.display_name,c.legal_name,c.ksic_code,i.industry_code,i.is_primary,i.review_status,i.valid_from_year,i.valid_to_year,i.evidence_json FROM industry_companies c JOIN company_industries i ON i.corp_code=c.corp_code',[]);
      companies=records.map(c=>({...c,valid_from_year:Number(c.valid_from_year),valid_to_year:c.valid_to_year==null?null:Number(c.valid_to_year),evidence:typeof c.evidence_json==='string'?JSON.parse(c.evidence_json):c.evidence_json}));
      validateCompanies(companies);mode='database';
    }
    const value={categories,companies,mode};catalogueCache={value,until:Date.now()+ttl};return value;
  }
  async function model(slug,query={}) {
    parseIndustryQuery(query);
    const catalog=await catalogue();const category=catalog.categories.find(c=>c.slug===slug && c.page_enabled);
    if(!category)return null;
    const members=catalog.companies.filter(c=>c.industry_code===category.code && c.review_status==='approved');
    if(!members.length)return buildIndustryModel(category,[],[],query);
    const key=JSON.stringify([catalog.mode,category.code,members.map(c=>[c.corp_code,c.valid_from_year,c.valid_to_year])]);
    let cache=rowsCache.get(key);
    if(!cache || cache.until<Date.now()){
      const params=[];const scope=members.map(c=>{params.push(c.corp_code,c.valid_from_year,c.valid_to_year,c.valid_to_year);return '(identity.corp_code=? AND s.fiscal_year>=? AND (? IS NULL OR s.fiscal_year<=?))';}).join(' OR ');
      const sources=catalog.mode==='database'?`SELECT salary_id,corp_code FROM salary_company_links WHERE review_status='approved' UNION ALL SELECT x.salary_id,MIN(x.corp_code) AS corp_code FROM salary_dart_sources x WHERE NOT EXISTS (SELECT 1 FROM salary_company_links l WHERE l.salary_id=x.salary_id AND l.review_status='approved') GROUP BY x.salary_id HAVING COUNT(DISTINCT x.corp_code)=1`:'SELECT salary_id,MIN(corp_code) AS corp_code FROM salary_dart_sources GROUP BY salary_id HAVING COUNT(DISTINCT corp_code)=1';
      const sql=`SELECT DISTINCT identity.corp_code,s.company_name,s.fiscal_year,s.employee_name,s.position_name,s.compensation FROM salary_data s JOIN (${sources}) identity ON identity.salary_id=s.id WHERE ${scope}`;
      const [rows]=await getDatabase().execute(sql,params);cache={rows,until:Date.now()+ttl};rowsCache.set(key,cache);
    }
    const result=buildIndustryModel(category,members,cache.rows,query);
    return result;
  }
  return {catalogue,model};
}
module.exports={createIndustryService,buildIndustryModel,parseIndustryQuery,validateCompanies};
