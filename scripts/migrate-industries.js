require('dotenv').config();
const fs=require('fs');const path=require('path');const crypto=require('crypto');const zlib=require('zlib');
const {database}=require('../lib/db');const {validateCompanies}=require('../lib/industries');
const categories=require('../data/industry-categories.json');const companyFile=require('../data/industry-companies.json');
const TABLES=['industry_categories','industry_companies','company_industries','salary_company_links'];
function migrationPlan(){
 validateCompanies(companyFile.companies);
 const sql=fs.readFileSync(path.join(__dirname,'../migrations/001-industries.sql'),'utf8').replace(/^--.*$/gm,'');
 const statements=sql.split(';').map(s=>s.trim()).filter(Boolean);
 if(statements.length!==4 || statements.some(s=>!/^CREATE TABLE IF NOT EXISTS (industry_categories|industry_companies|company_industries|salary_company_links)\s*\(/.test(s)) || /\b(DROP|TRUNCATE|DELETE|ALTER|UPDATE)\b/i.test(sql))throw new Error('Expected additive industry schema only');
 return {version:1,tables:TABLES,categories:categories.length,companies:companyFile.companies.length,approved:companyFile.companies.filter(c=>c.review_status==='approved').length,pending:companyFile.companies.filter(c=>c.review_status==='pending').length,statements};
}
async function run({apply=false,seedOnly=false}={}){
 const plan=migrationPlan();const pool=database();let c;let locked=false,transaction=false,backupFile;
 try{
  c=await pool.getConnection();const [tls]=await c.query("SHOW STATUS LIKE 'Ssl_cipher'");if(!tls[0]?.Value)throw new Error('Verified TLS required');
  const [tableRows]=await c.query('SHOW TABLES');const existing=tableRows.map(r=>Object.values(r)[0]);
  if(!['salary_data','salary_dart_sources'].every(t=>existing.includes(t)))throw new Error('Existing salary tables are required');
  const present=TABLES.filter(t=>existing.includes(t));
  if(present.length && present.length!==4)throw new Error('Partial industry schema: manual review is required before changes');
  if(seedOnly && present.length!==4)throw new Error('Seed-only requires all four existing industry tables');
  if(apply && present.length===4 && !seedOnly)throw new Error('Schema already exists; review an explicit --seed-only plan');
  const [[count]]=await c.query('SELECT COUNT(*) AS salary_rows FROM salary_data');
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',seedOnly,newTables:plan.tables.filter(t=>!existing.includes(t)),categorySeeds:plan.categories,companySeeds:plan.companies,approved:plan.approved,pending:plan.pending,existingSalaryRows:Number(count.salary_rows)}));
  if(!apply)return;
  const [[lock]]=await c.query("SELECT GET_LOCK('salary_dart_import',10) AS acquired");if(Number(lock.acquired)!==1)throw new Error('Data import already running');locked=true;
  const backup={createdAt:new Date().toISOString(),tables:{}};const backedTables=['salary_data','salary_dart_sources',...present];
  await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');transaction=true;
  for(const table of backedTables){const [schema]=await c.query('SHOW CREATE TABLE '+table);const [rows]=await c.query('SELECT * FROM '+table+(table==='salary_data'?' ORDER BY id':table==='salary_dart_sources'?' ORDER BY fingerprint':''));backup.tables[table]={schema:Object.values(schema[0])[1],rows};}
  await c.commit();transaction=false;
  const dir=path.resolve('var/backups');fs.mkdirSync(dir,{recursive:true,mode:0o700});const bytes=Buffer.from(JSON.stringify(backup));backupFile=path.join(dir,'before-industries-'+Date.now()+'.json.gz');fs.writeFileSync(backupFile,zlib.gzipSync(bytes),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({backup:backupFile,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));
  if(!seedOnly)for(const statement of plan.statements)await c.query(statement);
  await c.beginTransaction();transaction=true;
  const parent={code:'FINANCE',slug:'finance',name:'금융',description:'금융업 세부 분류의 상위 노드',parent_code:null,sort_order:0,page_enabled:false};
  for(const item of [parent,...categories]){
   const [old]=await c.execute('SELECT code,slug FROM industry_categories WHERE code=?',[item.code]);
   if(!old.length)await c.execute('INSERT INTO industry_categories (code,slug,name,parent_code,description,sort_order,page_enabled) VALUES (?,?,?,?,?,?,?)',[item.code,item.slug,item.name,item.parent_code,item.description,item.sort_order,item.page_enabled?1:0]);
   else {if(old[0].slug!==item.slug)throw new Error('Existing category identity differs');await c.execute('UPDATE industry_categories SET name=?,description=?,sort_order=?,page_enabled=? WHERE code=?',[item.name,item.description,item.sort_order,item.page_enabled?1:0,item.code]);}
  }
  for(const item of companyFile.companies){
   const [stockMatches]=item.stock_code?await c.execute('SELECT corp_code FROM industry_companies WHERE stock_code=?',[item.stock_code]):[[]];
   if(stockMatches.some(r=>r.corp_code!==item.corp_code))throw new Error('Ambiguous stock-code identity');
   const [old]=await c.execute('SELECT corp_code FROM industry_companies WHERE corp_code=?',[item.corp_code]);
   if(!old.length)await c.execute('INSERT INTO industry_companies (corp_code,stock_code,display_name,legal_name,ksic_code,source_url,verified_on) VALUES (?,?,?,?,?,?,?)',[item.corp_code,item.stock_code,item.display_name,item.legal_name,item.ksic_code,item.evidence.source_url,item.evidence.checked_on]);
   const [memberships]=await c.execute('SELECT industry_code,is_primary,review_status,valid_from_year,valid_to_year FROM company_industries WHERE corp_code=?',[item.corp_code]);
   const exact=memberships.find(r=>r.industry_code===item.industry_code && Number(r.valid_from_year)===item.valid_from_year);
   if(exact){if(exact.review_status!==item.review_status || Boolean(exact.is_primary)!==Boolean(item.is_primary) || (exact.valid_to_year==null?null:Number(exact.valid_to_year))!==item.valid_to_year)throw new Error('Existing reviewed classification differs; explicit correction required');continue;}
   if(item.is_primary && item.review_status==='approved' && memberships.some(r=>r.is_primary&&r.review_status==='approved'&&Math.max(Number(r.valid_from_year),item.valid_from_year)<=Math.min(r.valid_to_year??9999,item.valid_to_year??9999)))throw new Error('Overlapping primary classifications');
   await c.execute('INSERT INTO company_industries (corp_code,industry_code,valid_from_year,valid_to_year,is_primary,review_status,evidence_json,reviewed_on) VALUES (?,?,?,?,?,?,?,?)',[item.corp_code,item.industry_code,item.valid_from_year,item.valid_to_year,item.is_primary?1:0,item.review_status,JSON.stringify(item.evidence),item.evidence.checked_on]);
  }
  await c.query(`INSERT INTO salary_company_links (salary_id,corp_code,review_status,match_method,evidence_json,reviewed_on)
    SELECT x.salary_id,x.corp_code,'approved','dart_source',JSON_OBJECT('source','salary_dart_sources','rcept_no',x.rcept_no),CURRENT_DATE()
    FROM (SELECT salary_id,MIN(corp_code) AS corp_code,MAX(rcept_no) AS rcept_no FROM salary_dart_sources GROUP BY salary_id HAVING COUNT(DISTINCT corp_code)=1) x
    JOIN industry_companies c ON c.corp_code=x.corp_code WHERE NOT EXISTS (SELECT 1 FROM salary_company_links l WHERE l.salary_id=x.salary_id)`);
  for(const table of ['salary_data','salary_dart_sources']){const [rows]=await c.query('SELECT * FROM '+table+(table==='salary_data'?' ORDER BY id':' ORDER BY fingerprint'));if(JSON.stringify(rows)!==JSON.stringify(backup.tables[table].rows))throw new Error('Original salary data changed during migration');}
  await c.commit();transaction=false;console.log(JSON.stringify({applied:true,originalTablesUnchanged:true,backup:backupFile}));
 }catch(e){if(c&&transaction)await c.rollback();if(backupFile)console.error('Backup retained:',backupFile,'MySQL DDL may require partial-schema review.');throw e;}
 finally{if(c){if(locked)await c.query("SELECT RELEASE_LOCK('salary_dart_import')");c.release();}await pool.end();}
}
if(require.main===module){if(process.argv.includes('--plan-only')){const {statements,...plan}=migrationPlan();console.log(JSON.stringify({...plan,mode:'offline-plan',sqlStatements:statements.length}));}else run({apply:process.argv.includes('--apply'),seedOnly:process.argv.includes('--seed-only')}).catch(e=>{console.error('Industry migration:',e.code||e.message);process.exitCode=1;});}
module.exports={migrationPlan};
