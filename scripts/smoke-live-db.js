require('dotenv').config();const assert=require('assert/strict');const app=require('../server');const {database}=require('../lib/db');const {categories}=require('../lib/pages');
(async()=>{let server;try{
 server=app.listen(0,'127.0.0.1');await new Promise((r,j)=>{server.once('listening',r);server.once('error',j);});const base='http://127.0.0.1:'+server.address().port;
 const years=await(await fetch(base+'/api/years')).json();assert(years.includes(2025)&&years.includes(2024));
 const rows=await(await fetch(base+'/api/search?company='+encodeURIComponent('삼성전자')+'&year=2025&sort=salary')).json();assert.equal(rows.length,5);assert(rows.every(r=>r.fiscal_year===2025));
 const pages=[];for(const category of categories){const response=await fetch(base+'/rankings/'+category.slug+'?year=2025');assert.equal(response.status,200);const html=await response.text();assert(html.includes(category.title));assert(!html.includes('adsbygoogle'));pages.push({slug:category.slug,rows:(html.match(/<tr><td>/g)||[]).length});}
 console.log(JSON.stringify({years,companySearch2025:rows.length,categoryPages:pages}));
}finally{if(server)await new Promise(r=>server.close(r));await database().end();}})().catch(e=>{console.error('Live DB smoke check failed:',e.code||e.message);process.exitCode=1;});
