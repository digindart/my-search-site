// Offline, reproducible classification from previously fetched official metadata.
// Does not connect to or mutate a database. Run after evidence review.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {classifyIndustry}=require('../lib/industry-classifier');
const overrides=require('../data/industry-overrides.json');
function build(){
 const root=path.resolve(__dirname,'..'),stage=JSON.parse(fs.readFileSync(path.join(root,'var/dart/staged.json')));
 if(!stage.complete)throw new Error('Incomplete acquisition');
 const ids=[...new Set(stage.records.map(r=>r.corp_code))].sort(),companies=[],pending=[];
 const checked_on='2026-11-14';
 for(const corp_code of ids){
  const raw=fs.readFileSync(path.join(root,'var/industries/companies',corp_code+'.json')),meta=JSON.parse(raw);
  if(meta.status!=='000')throw new Error('Invalid company response');
  const override=overrides.companies[corp_code];
  if(override&&meta.induty_code!=='64992')throw new Error('Override metadata changed; re-review required');
  const industry_code=override||classifyIndustry(meta.induty_code);
  if(!industry_code){pending.push({corp_code,display_name:meta.stock_name||meta.corp_name,ksic_code:meta.induty_code,review_status:'pending',reason:'업종코드가 포괄적이거나 현재 분류 범위 밖임. 주요 사업 및 지주회사 유형 검토 필요'});continue;}
  companies.push({corp_code,stock_code:/^\d{6}$/.test(meta.stock_code)?meta.stock_code:null,display_name:meta.stock_name||meta.corp_name,legal_name:meta.corp_name,ksic_code:meta.induty_code,industry_code,is_primary:true,review_status:'approved',valid_from_year:2024,valid_to_year:null,evidence:{source_type:override?'reviewed_financial_holding':'opendart_company_ksic',source_url:override?overrides.source_url:'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002',ksic_source_url:'https://kostat.go.kr/boardDownload.es?bid=107&list_no=428660&seq=6',corp_code,ksic_code:meta.induty_code,checked_on,basis:override?overrides.basis:`DART 기업개황 업종코드 ${meta.induty_code}를 한국표준산업분류 및 서비스 업권 매핑에 대조. 포괄 코드의 업권 충돌은 제외`,response_sha256:crypto.createHash('sha256').update(raw).digest('hex')}});
 }
 fs.writeFileSync(path.join(root,'data/industry-companies.json'),JSON.stringify({version:2,classification_date:checked_on,scope:'실제 2024·2025년 보수 자료와 DART 고유번호가 연결된 법인. 일반 지주회사 및 불명확한 업종 제외',companies},null,2)+'\n');
 fs.writeFileSync(path.join(root,'data/industry-review-queue.json'),JSON.stringify({classification_date:checked_on,companies:pending},null,2)+'\n');
 const categories=JSON.parse(fs.readFileSync(path.join(root,'data/industry-categories.json')));
 for(const c of categories){if(!companies.some(m=>m.industry_code===c.code))throw new Error('Empty category '+c.code);c.page_enabled=true;}
 fs.writeFileSync(path.join(root,'data/industry-categories.json'),JSON.stringify(categories,null,2)+'\n');
 console.log(JSON.stringify({approved:companies.length,pending:pending.length,categories:categories.map(c=>({code:c.code,companies:companies.filter(m=>m.industry_code===c.code).length}))}));
}
if(require.main===module)build();module.exports={build};
