// Read-only discovery. Outputs proposals; never writes classifications to a DB.
require('dotenv').config();const fs=require('fs');const path=require('path');const {database}=require('../lib/db');
const {classifyIndustry}=require('../lib/industry-classifier');
const knownFile=require('../data/industry-companies.json');const projectRoot=path.resolve(__dirname,'..');
async function main(){
 const args=process.argv.slice(2);const value=k=>{const i=args.indexOf(k);return i<0?null:args[i+1];};
 const limit=Number(value('--limit')||20);if(!Number.isInteger(limit)||limit<1||limit>5000)throw new Error('Invalid limit');
 const source=value('--from-stage');let records,registered=[];
 if(source){const stage=JSON.parse(fs.readFileSync(source));if(!stage.complete)throw new Error('Incomplete acquisition package');records=stage.records;}
 else{const pool=database();try{[records]=await pool.query('SELECT DISTINCT x.corp_code,s.company_name FROM salary_dart_sources x JOIN salary_data s ON s.id=x.salary_id');try{[registered]=await pool.query('SELECT corp_code FROM industry_companies');}catch(e){if(e.code!=='ER_NO_SUCH_TABLE')throw e;}}finally{await pool.end();}}
 const known=new Set([...knownFile.companies,...registered].map(c=>c.corp_code));
 const unique=new Map();for(const r of records)if(/^\d{8}$/.test(r.corp_code))unique.set(r.corp_code,{corp_code:r.corp_code,reported_name:r.company_name});
 const candidates=[...unique.values()].filter(c=>args.includes('--refresh-known')?known.has(c.corp_code):!known.has(c.corp_code));const approvedProposals=[],needsReview=[],errors=[];
 const cache=path.join(projectRoot,'var/industries/companies');fs.mkdirSync(cache,{recursive:true});
 for(const candidate of candidates){
  if(!args.includes('--fetch-metadata')||approvedProposals.length+needsReview.filter(c=>c.metadata_checked).length+errors.length>=limit){needsReview.push({...candidate,review_status:'unclassified',reason:'기업개황 및 주요 사업 검토 전'});continue;}
  try{
   const file=path.join(cache,candidate.corp_code+'.json');let meta;
   if(fs.existsSync(file)&&!args.includes('--refresh-known'))meta=JSON.parse(fs.readFileSync(file));else{
    if(!process.env.DART_API_KEY)throw new Error('API key required');
    const url=new URL('https://opendart.fss.or.kr/api/company.json');url.searchParams.set('crtfc_key',process.env.DART_API_KEY);url.searchParams.set('corp_code',candidate.corp_code);
    const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('transport');meta=await response.json();if(meta.status!=='000')throw new Error('status '+meta.status);fs.writeFileSync(file,JSON.stringify(meta,null,2));
   }
   const industry_code=classifyIndustry(meta.induty_code);
   if(industry_code)approvedProposals.push({...candidate,legal_name:meta.corp_name,display_name:meta.stock_name||meta.corp_name,stock_code:meta.stock_code||null,ksic_code:meta.induty_code,industry_code,is_primary:true,review_status:'pending',proposed_status:'approved',proposal_only:true,valid_from_year:null,valid_to_year:null,evidence:{source_url:'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002',basis:'기업개황 KSIC와 업권 매핑 확인. 적용 기간은 원문 검토 후 확정',checked_on:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'})}});
   else needsReview.push({...candidate,ksic_code:meta.induty_code,review_status:'pending',metadata_checked:true,reason:'포괄 코드 또는 분류 범위 밖이므로 주요 사업 검토 필요'});
  }catch(e){errors.push({...candidate,error:'기업개황 조회 실패: 키와 URL은 기록하지 않음'});}
 }
 const output=path.join(projectRoot,'var/industries/classification-proposals.json');fs.writeFileSync(output,JSON.stringify({proposal_only:true,approvedProposals,needsReview,errors},null,2));
 console.log(JSON.stringify({scope:args.includes('--refresh-known')?'refresh-known':'new-identities',identities:candidates.length,classificationProposals:approvedProposals.length,unclassifiedOrPending:needsReview.length,errors:errors.length,output}));
 if(errors.length)process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error('Classification preparation failed:',e.code||'Check local inputs or connection');process.exitCode=1;});
