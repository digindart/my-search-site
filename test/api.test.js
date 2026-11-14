const test=require('node:test');const assert=require('node:assert/strict');
const db=require('../lib/db');const calls=[];
const searchRows=[
 {company_name:'삼성전자',fiscal_year:2025,employee_name:'홍길동',position_name:'대표이사',compensation:'900000000'},
 {company_name:'삼성전기',fiscal_year:2025,employee_name:'김길동',position_name:'이사',compensation:'700000000'},
 {company_name:'삼성전자',fiscal_year:2024,employee_name:'홍길동',position_name:'대표이사',compensation:'800000000'},
 {company_name:'현대자동차',fiscal_year:2025,employee_name:'이길동',position_name:'이사',compensation:'600000000'}
];
const groupRows=[searchRows[0],...['LG전자','신세계','한진','GS','CJ','카카오','두산','DL','효성','하림','대우건설','POSCO홀딩스','셀트리온','NAVER'].map(company_name=>({...searchRows[0],company_name}))];
db.database=()=>({execute:async(sql,params)=>{calls.push({sql,params});if(sql.includes('SELECT DISTINCT fiscal_year'))return [[{fiscal_year:2025}]];if(sql.includes('SELECT DISTINCT company_name FROM'))return [[{company_name:'삼성전자'}]];
 if(sql.includes('WHERE company_name LIKE ?')||sql.includes('WHERE company_name = ?')){const partial=sql.includes('WHERE company_name LIKE ?');const phrase=partial?params[0].slice(1,-1).replace(/!([!%_])/g,'$1'):params[0];return [searchRows.filter(r=>(partial?r.company_name.includes(phrase):r.company_name===phrase)&&(params.length<2||r.fiscal_year===params[1]))];}
 if(sql.includes('company_name IN')){const year=params.find(p=>typeof p==='number');return [groupRows.filter(r=>params.includes(r.company_name)&&(year==null||r.fiscal_year===year))];}return [[searchRows[0]]];},query:async()=>[[{fiscal_year:2025}]]});
const app=require('../server');let server,base;
test.before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;});
test.after(()=>new Promise(r=>server.close(r)));
test('invalid year rejected before any database access',async()=>{const before=calls.length;const res=await fetch(base+'/api/search?company=test&year=bad');assert.equal(res.status,400);assert.equal(calls.length,before);});
test('company search parameterized and deduplicated',async()=>{const name="a' OR 1=1 --";const res=await fetch(base+'/api/search?company='+encodeURIComponent(name));assert.equal(res.status,200);const last=calls.at(-1);assert.equal(last.params[0],'%'+name+'%');assert(!last.sql.includes(name));assert(last.sql.startsWith('SELECT DISTINCT'));});
test('autocomplete escapes literal SQL wildcards',async()=>{await fetch(base+'/api/suggest?company=a%25_');const last=calls.at(-1);assert.equal(last.params[0],'%a!%!_%');assert(last.sql.includes("ESCAPE '!'"));});
test('category page is rendered on server with real links',async()=>{const res=await fetch(base+'/rankings/samsung');const html=await res.text();assert.equal(res.status,200);assert(html.includes('홍길동'));assert(html.includes('더 알아보기'));assert(html.includes('900,000,000원'));});
test('homepage preserves company search without ranking cards',async()=>{const res=await fetch(base);const html=await res.text();assert.equal(res.status,200);assert.equal((html.match(/<style>/g)||[]).length,1);assert(!html.includes('adsbygoogle'));assert(html.includes('id="company"'));assert(html.includes('/autocomplete.js'));assert(html.includes('href="/groups"'));assert(!html.includes('공시 보수 순위 살펴보기'));assert(!html.includes('href="/groups/samsung"'));assert(!html.includes('href="/rankings/samsung"'));});
test('unknown category returns 404 and sitemap covers all categories',async()=>{assert.equal((await fetch(base+'/rankings/no-such-group')).status,404);const xml=await(await fetch(base+'/sitemap.xml')).text();assert(xml.includes('/groups/hyundai-motor'));assert(xml.includes('/methodology'));});

 test('autocomplete endpoint is available to the main search page',async()=>{const res=await fetch(base+'/api/suggest?company='+encodeURIComponent('삼성'));assert.equal(res.status,200);assert.deepEqual(await res.json(),['삼성전자']);});
 test('groups have a separate directory and canonical detail pages',async()=>{const listing=await(await fetch(base+'/groups')).text();assert.equal((listing.match(/<a class="card"/g)||[]).length,20);assert(listing.includes('/groups/hyundai'));assert(listing.includes('/groups/hyundai-motor'));assert(!listing.includes('/groups/securities'));const html=await(await fetch(base+'/groups/samsung')).text();assert(html.includes('canonical" href="https://salaryinsight.co.kr/groups/samsung'));assert(html.includes('홍길동'));});
 test('legacy group links preserve year when redirecting to separate group pages',async()=>{const res=await fetch(base+'/rankings/samsung?year=2024',{redirect:'manual'});assert.equal(res.status,301);assert.equal(res.headers.get('location'),'/groups/samsung?year=2024');});

test('company and group headers use the same brand markup and button styles',async()=>{const {siteHeader}=require('../lib/brand');const home=await(await fetch(base)).text();const group=await(await fetch(base+'/groups/samsung')).text();assert(home.includes(siteHeader('search')));assert(group.includes(siteHeader('groups')));for(const html of [home,group])assert(html.includes('/brand.css'));assert(home.includes('link.className = "button more-info-button"'));const css=await(await fetch(base+'/brand.css')).text();assert(css.includes('.button,.more-info-button'));});

test('partial company search returns all matching companies and respects year filters',async()=>{const all=await(await fetch(base+'/api/search?company='+encodeURIComponent('삼성'))).json();assert.equal(all.length,3);assert.deepEqual([...new Set(all.map(r=>r.company_name))].sort(),['삼성전기','삼성전자'].sort());assert(!all.some(r=>r.company_name==='현대자동차'));const year=await(await fetch(base+'/api/search?company='+encodeURIComponent('삼성')+'&year=2025')).json();assert.equal(year.length,2);assert(year.every(r=>r.fiscal_year===2025));});
test('selected company exact mode does not include other matching companies',async()=>{const result=await(await fetch(base+'/api/search?company='+encodeURIComponent('삼성전자')+'&match=exact')).json();assert.equal(result.length,2);assert(result.every(r=>r.company_name==='삼성전자'));assert.equal((await fetch(base+'/api/search?company=test&match=invalid')).status,400);});
test('partial company search escapes wildcard characters as literals',async()=>{const result=await(await fetch(base+'/api/search?company='+encodeURIComponent('삼성%'))).json();assert.equal(result.length,0);assert.equal(calls.at(-1).params[0],'%삼성!%%');});

test('LG, Shinsegae, Hanjin, GS and CJ pages expose only their configured companies',async()=>{for(const [slug,company] of [['lg','LG전자'],['shinsegae','신세계'],['hanjin','한진'],['gs','GS'],['cj','CJ']]){const response=await fetch(base+'/groups/'+slug);const html=await response.text();assert.equal(response.status,200);assert(html.includes('href="https://salaryinsight.co.kr/groups/'+slug));assert(html.includes('<td>'+company+'</td>'));assert(!html.includes('<td>삼성전자</td>'));}const xml=await(await fetch(base+'/sitemap.xml')).text();for(const slug of ['lg','shinsegae','hanjin','gs','cj'])assert(xml.includes('/groups/'+slug));const home=await(await fetch(base)).text();assert(home.includes('href="/groups">기업그룹별 정보</a>'));});
test('additional groups have scoped pages, directory cards and sitemap entries',async()=>{
 const listing=await(await fetch(base+'/groups')).text(),xml=await(await fetch(base+'/sitemap.xml')).text();
 for(const [slug,company] of [['kakao','카카오'],['doosan','두산'],['dl','DL'],['hyosung','효성'],['harim','하림'],['jungheung','대우건설'],['posco','POSCO홀딩스'],['celltrion','셀트리온'],['naver','NAVER']]){
  assert(listing.includes('/groups/'+slug));assert(xml.includes('/groups/'+slug));
  const res=await fetch(base+'/groups/'+slug),html=await res.text();assert.equal(res.status,200);assert(!html.includes('<td>삼성전자</td>'));
  if(company)assert(html.includes('<td>'+company+'</td>'));else {assert(html.includes('자료가 아직 없습니다'));assert(html.includes('noindex,follow'));}
 }
});
test('group selection does not include similarly named unrelated or separated companies',()=>{
 const {groups}=require('../lib/group-pages');
 assert(!groups.find(g=>g.slug==='hyosung').companies.includes('효성오앤비'));
 assert(!groups.find(g=>g.slug==='hyosung').companies.includes('HS효성'));
 assert(!groups.find(g=>g.slug==='harim').companies.includes('선진뷰티사이언스'));
 assert(!groups.find(g=>g.slug==='doosan').companies.includes('두산건설'));
 assert(!groups.find(g=>g.slug==='dl').companies.includes('사조대림'));
});

test('removed groups are absent from directory and sitemap and return 404',async()=>{
 const listing=await(await fetch(base+'/groups')).text(),xml=await(await fetch(base+'/sitemap.xml')).text();
 for(const slug of ['coupang','booyoung']){assert(!listing.includes('/groups/'+slug));assert(!xml.includes('/groups/'+slug));assert.equal((await fetch(base+'/groups/'+slug)).status,404);assert.equal((await fetch(base+'/rankings/'+slug)).status,404);}
});
