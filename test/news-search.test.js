const test=require('node:test'),assert=require('node:assert/strict');
const {cleanPosition,newsURL}=require('../public/news-search');
test('search removes annotation symbols but keeps meaningful position words',()=>{
 assert.equal(cleanPosition('대표이사(사장) ※1 주2)'),'대표이사 사장');
 assert.equal(cleanPosition('前)미등기임원(상무)\n*'),'전 미등기임원 상무');
 assert.equal(cleanPosition('부문장 / 부사장 [1]'),'부문장 부사장');
 assert.equal(cleanPosition(null),'');
 const url=new URL(newsURL({employee_name:'홍길동',company_name:'삼성전자',position_name:'대표이사(사장)',fiscal_year:2025}));
 assert.equal(url.searchParams.get('query'),'홍길동 삼성전자 대표이사 사장');
});
test('main search and server-rendered pages share the same news search function',()=>{
 const fs=require('fs'),html=fs.readFileSync(require.resolve('../public/index.html'),'utf8');
 assert(html.includes('src="/news-search.js"'));assert(html.includes('SalaryNewsSearch.newsURL(item)'));
 assert.equal(require('../lib/pages').newsURL,newsURL);
});
