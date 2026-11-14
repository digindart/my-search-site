const test=require('node:test');const assert=require('node:assert/strict');
const {esc,newsURL,categoryPage,categories,money}=require('../lib/pages');
test('news search excludes the fiscal year and uses a news endpoint',()=>{
 const r={employee_name:'홍 길동',company_name:'A&B',position_name:'전 대표이사',fiscal_year:2025};
 const url=new URL(newsURL(r));assert.equal(url.searchParams.get('query'),'홍 길동 A&B 전 대표이사');assert.equal(url.searchParams.get('where'),'news');
});
test('ranking renders exact won values, tied ranks and safe person data',()=>{
 const rows=[{company_name:'삼성전자',fiscal_year:2025,employee_name:'<script>alert(1)</script>',position_name:'대표이사',compensation:'900000001'}, {company_name:'삼성전자',fiscal_year:2025,employee_name:'나',position_name:'이사',compensation:'900000001'}, {company_name:'삼성전자',fiscal_year:2025,employee_name:'다',position_name:'이사',compensation:'800000000'}];
 const html=categoryPage(categories[3],2025,[2025],rows);
 assert(!html.includes('<script>alert(1)</script>'));assert(html.includes('&lt;script&gt;'));
 assert.equal((html.match(/<tr><td>1<\/td>/g)||[]).length,2);assert(html.includes('<tr><td>3</td>'));
 assert(html.includes('900,000,001원'));assert(html.includes('noopener noreferrer'));assert(!html.includes('adsbygoogle'));
});
test('empty rankings are not indexed and do not invent zero pay',()=>{
 const html=categoryPage(categories[0],2025,[],[]);assert(html.includes('noindex,follow'));assert(html.includes('아직 없습니다'));assert(!html.includes('<tbody>'));
});
test('Hyundai groups are separated, no name-prefix grouping',()=>{
 assert(categories.find(c=>c.slug==='hyundai'));assert(categories.find(c=>c.slug==='hyundai-motor'));assert(!categories.find(c=>c.slug==='hyundai').companies.includes('현대자동차'));
});
test('won formatting preserves integers beyond JS float precision',()=>assert.equal(money('9007199254740993'),'9,007,199,254,740,993원'));

test('anonymous disclosure names stay anonymous and have no news link',()=>{
 const html=categoryPage(categories[0],2025,[2025],[{company_name:'회사',fiscal_year:2025,employee_name:'김OO',position_name:'직원',compensation:'900000000'}]);
 assert(html.includes('김OO (공시 익명)'));assert(!html.includes('search.naver.com'));
});
