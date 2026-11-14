require('dotenv').config();
const {isMaskedName}=require('../lib/quality');
const fs=require('fs');const crypto=require('crypto');const path=require('path');const {database}=require('../lib/db');
async function main(){
 const args=process.argv.slice(2);const file=args.find(a=>!a.startsWith('--'))||'var/dart/staged.json';
 const raw=fs.readFileSync(file);const digest=crypto.createHash('sha256').update(raw).digest('hex');
 const expected=fs.readFileSync(path.join(path.dirname(file),'staged.sha256'),'utf8').trim();
 if(digest!==expected)throw new Error('Stage checksum mismatch; regenerate or review the source package');
 const data=JSON.parse(raw);
 if(data.version!==1 || !data.complete || !data.coverage?.length || data.coverage.length!==data.expected_company_years || data.failures?.length)throw new Error('Only a complete acquisition package can be applied');
 if(data.records.some(r=>![2024,2025].includes(r.fiscal_year)))throw new Error('Unexpected year');
 const pending=data.records.filter(r=>r.issues.length);const accepted=data.records.filter(r=>!r.issues.length);
 for(const r of accepted){if(!r.company_name || !r.employee_name || !r.position_name || !/^\d+$/.test(r.compensation) || BigInt(r.compensation)<500000000n || BigInt(r.compensation)>100000000000n || !/^\d{8}$/.test(r.corp_code) || !/^\d{14}$/.test(r.rcept_no))throw new Error('Invalid staged record');}
 console.log(JSON.stringify({dryRun:!args.includes('--apply'),accepted:accepted.length,pendingReview:pending.length,checksum:digest}));
 if(!args.includes('--apply'))return;
 if(pending.length && !args.includes('--skip-pending'))throw new Error('Review pending items first, or explicitly use --skip-pending to apply only validated records');
 if(!accepted.length)throw new Error('No validated rows to insert');
 const pool=database();let c;let locked=false;let inTransaction=false;
 const fields=['company_name','fiscal_year','employee_name','position_name','compensation'];
 const exactKey=r=>JSON.stringify(fields.map(k=>String(r[k]).normalize('NFC')));
 const personKey=r=>JSON.stringify(fields.slice(0,3).map(k=>String(r[k]).normalize('NFC')));
 try{
  c=await pool.getConnection();
  const [[lock]]=await c.query("SELECT GET_LOCK('salary_dart_import', 10) AS acquired");if(Number(lock.acquired)!==1)throw new Error('Import already in progress');locked=true;
  const [tls]=await c.query("SHOW STATUS LIKE 'Ssl_cipher'");if(!tls[0]?.Value)throw new Error('Verified TLS is required');
  await c.query(`CREATE TABLE IF NOT EXISTS salary_dart_sources (fingerprint CHAR(64) PRIMARY KEY, salary_id BIGINT UNSIGNED NOT NULL, corp_code CHAR(8) NOT NULL, fiscal_year SMALLINT NOT NULL, rcept_no CHAR(14) NOT NULL, source_unit VARCHAR(10) NOT NULL, raw_json LONGTEXT NOT NULL, changes_json LONGTEXT NOT NULL, package_sha CHAR(64) NOT NULL, imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await c.beginTransaction();inTransaction=true;
  const [knownSources]=await c.query('SELECT fingerprint FROM salary_dart_sources');const known=new Set(knownSources.map(r=>r.fingerprint));
  const [existing]=await c.query('SELECT id,company_name,fiscal_year,employee_name,position_name,compensation FROM salary_data WHERE fiscal_year IN (2024,2025)');
  const exact=new Map(existing.map(r=>[exactKey(r),r.id]));const people=new Map();
  for(const r of existing){const k=personKey(r);if(!people.has(k))people.set(k,new Set());people.get(k).add(exactKey(r));}
  const newRows=[];const provenance=[];let unchanged=0;
  for(const r of accepted){
   const values=fields.map(k=>r[k]);
   const fingerprint=crypto.createHash('sha256').update(JSON.stringify([r.corp_code,...values])).digest('hex');
   if(known.has(fingerprint)){unchanged++;continue;}
   const key=exactKey(r),person=personKey(r);
   if(!isMaskedName(r.employee_name) && people.has(person) && [...people.get(person)].some(k=>k!==key))throw new Error(`Conflicting existing record: ${r.corp_code}/${r.fiscal_year}. No data applied.`);
   if(!exact.has(key)){newRows.push(values);exact.set(key,null);if(!people.has(person))people.set(person,new Set());people.get(person).add(key);}else unchanged++;
   provenance.push({r,fingerprint,key});known.add(fingerprint);
  }
  for(let i=0;i<newRows.length;i+=300){const batch=newRows.slice(i,i+300);await c.query('INSERT INTO salary_data (company_name,fiscal_year,employee_name,position_name,compensation) VALUES ?',[batch]);console.log('Inserted',Math.min(i+batch.length,newRows.length),'/',newRows.length);}
  const [resolved]=await c.query('SELECT id,company_name,fiscal_year,employee_name,position_name,compensation FROM salary_data WHERE fiscal_year IN (2024,2025)');
  const ids=new Map(resolved.map(r=>[exactKey(r),r.id]));
  const sourceRows=provenance.map(({r,fingerprint,key})=>{const id=ids.get(key);if(!id)throw new Error('Inserted row could not be resolved');return [fingerprint,id,r.corp_code,r.fiscal_year,r.rcept_no,r.source_unit,JSON.stringify(r.raw),JSON.stringify(r.changes),digest];});
  for(let i=0;i<sourceRows.length;i+=200){await c.query('INSERT INTO salary_dart_sources (fingerprint,salary_id,corp_code,fiscal_year,rcept_no,source_unit,raw_json,changes_json,package_sha) VALUES ?',[sourceRows.slice(i,i+200)]);}
  await c.commit();inTransaction=false;console.log(JSON.stringify({inserted:newRows.length,unchanged,pendingReview:pending.length}));
 }catch(error){if(c&&inTransaction)await c.rollback();throw error;}finally{if(c){if(locked)await c.query("SELECT RELEASE_LOCK('salary_dart_import')");c.release();}await pool.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
