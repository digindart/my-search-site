const test=require('node:test'),assert=require('node:assert/strict');
const {buildIndustryModel,parseIndustryQuery,validateCompanies,createIndustryService}=require('../lib/industries');
const {industryPage}=require('../lib/industry-pages');const {serialize}=require('../public/csv');const {migrationPlan}=require('../scripts/migrate-industries');
const category=require('../data/industry-categories.json')[0];const member=require('../data/industry-companies.json').companies.find(c=>c.review_status==='approved'&&c.industry_code==='SECURITIES');
const row=(changes={})=>({corp_code:member.corp_code,company_name:member.display_name,fiscal_year:2025,employee_name:'홍길동',position_name:'이사',compensation:'900000000',...changes});
test('industry membership depends on approved DART identity, not display name',()=>{
 const pending={...member,corp_code:'99999998',review_status:'pending'};
 const m=buildIndustryModel(category,[member,pending],[row(),row({corp_code:'99999999'}),row({corp_code:pending.corp_code}),row({fiscal_year:2023})],{});
 assert.equal(m.totalDisclosures,1);assert.deepEqual(m.years,[2025]);
});
test('renaming does not double count a matching disclosure for one legal entity',()=>{
 const m=buildIndustryModel(category,[member],[row(),row({company_name:'이전 회사명'})],{});assert.equal(m.totalDisclosures,1);
});
test('filters are ANDed and confined to the selected industry and year',()=>{
 const rows=[row(),row({employee_name:'김길동',position_name:'대표이사'}),row({fiscal_year:2024}),row({corp_code:'99999999',employee_name:'외부인'})];
 const m=buildIndustryModel(category,[member],rows,{name:'홍',company:member.corp_code,position:'이사',year:'2025'});
 assert.equal(m.total,1);assert.equal(m.top20.length,2);assert.equal(m.results[0].employee_name,'홍길동');
 assert.equal(buildIndustryModel(category,[member],rows,{name:'외부인'}).total,0);
 assert.throws(()=>buildIndustryModel(category,[member],rows,{year:'2023'}),/연도/);
});
test('top 20, joint ranks and detailed result pagination are independent',()=>{
 const rows=Array.from({length:45},(_,i)=>row({employee_name:'인물'+i,compensation:String(1000000000-Math.floor(i/2)*1000000)}));
 const m=buildIndustryModel(category,[member],rows,{page:'2'});assert.equal(m.top20.length,20);assert.equal(m.results.length,20);assert.equal(m.results[0].rank,21);assert.equal(m.top20[1].rank,1);assert.equal(m.top20[2].rank,3);assert.equal(m.totalPages,3);
 assert.equal(buildIndustryModel(category,[member],rows,{page:'999'}).page,3);
});
test('bad search inputs and conflicting primary classifications are rejected',()=>{
 for(const q of [{year:'2025 OR 1'},{page:'-1'},{page:'1.5'},{name:['a','b']},{position:'x'.repeat(256)}])assert.throws(()=>parseIndustryQuery(q));
 assert.throws(()=>validateCompanies([member,{...member,industry_code:'BANKING'}]),/Overlapping/);
 assert.throws(()=>validateCompanies([{...member,stock_code:'123456'},{...member,stock_code:'123456',corp_code:'99999999'}]),/stock code/i);
});
test('HTML contains data before JS, escaped filters, year-only data and scoped links',()=>{
 const m=buildIndustryModel(category,[member],[row()],{name:'<img src=x onerror=alert(1)>'});
 const html=industryPage(m);assert(html.includes('900,000,000원'));assert(html.includes('홍길동'));assert(!html.includes('<img src=x'));assert(html.includes('&lt;img'));assert(html.includes('noindex,follow'));assert(html.includes('canonical'));assert(html.includes('/industries/securities'));assert(html.includes('company='+encodeURIComponent(member.display_name)));assert(!html.includes('adsbygoogle'));
 const empty=industryPage(buildIndustryModel(category,[member],[],{}));assert(empty.includes('자료가 없습니다'));assert(empty.includes('noindex,follow'));
});
test('CSV uses the same escaping as company search and preserves exact won values',()=>{
 const csv=serialize([['=SUM(1,2)','홍"길동','900000001','line\nline']]);assert(csv.includes('"\'=SUM(1,2)"'));assert(csv.includes('"홍""길동"'));assert(csv.includes('"900000001"'));assert(csv.includes('line\nline'));
});
test('classification preview is read-only and SQL scopes by corp_code with bound parameters',async()=>{
 const calls=[];const db={execute:async(sql,params)=>{calls.push({sql,params});if(sql.includes('FROM industry_categories')){const e=new Error();e.code='ER_NO_SUCH_TABLE';throw e;}return [[row()]];}};
 const service=createIndustryService(()=>db,{ttl:0});await service.model('securities',{company:"' OR 1=1 --"});
 assert(calls.every(c=>/^SELECT/.test(c.sql)));const call=calls.find(c=>c.sql.includes('salary_data s'));assert(call.sql.includes('identity.corp_code=?'));assert(!call.sql.includes("' OR 1=1"));assert(call.params.includes(member.corp_code));assert(!call.sql.includes('company_name IN'));
 assert.equal((await service.model('banking',{})).totalDisclosures,0);
});
test('migration plan is additive and seeds all 20 categories without editing salary tables',()=>{
 const p=migrationPlan();assert.equal(p.categories,20);assert(p.approved>900);assert.equal(p.pending,0);assert.equal(p.statements.length,4);assert(p.statements.every(s=>s.startsWith('CREATE TABLE IF NOT EXISTS')));assert(!p.statements.some(s=>/CREATE TABLE IF NOT EXISTS salary_data\b/.test(s)));
});
test('company summary links to exact company search using reported alias and selected year',()=>{
 const model=buildIndustryModel(category,[{...member,display_name:'변경된 이름'}],[row({company_name:'실제 공시 이름'})],{});
 const html=industryPage(model),section=html.split('<h2>기업별 고액보수 현황</h2>')[1].split('<section id="industry-search">')[0];
 assert(!section.includes('분류 근거'));assert(!section.includes('분류 출처'));assert(!section.includes('KSIC'));
 const href=section.match(/<a href="([^"]+)">변경된 이름<\/a>/)[1].replace(/&amp;/g,'&');
 const url=new URL(href,'http://localhost');assert.equal(url.pathname,'/');assert.equal(url.searchParams.get('company'),'실제 공시 이름');assert.equal(url.searchParams.get('match'),'exact');assert.equal(url.searchParams.get('year'),'2025');
});
