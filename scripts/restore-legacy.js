require('dotenv').config();
const fs=require('fs');const crypto=require('crypto');const path=require('path');const {database}=require('../lib/db');
async function main(){
 const source=path.resolve(process.argv[2]||'../salary_data.sql');const sql=fs.readFileSync(source,'utf8');
 const create=sql.match(/CREATE TABLE `salary_data` \([\s\S]+?\) ENGINE[^;]+;/)?.[0];
 const data=sql.match(/INSERT INTO `salary_data` VALUES\s*\n([\s\S]+?);\s*\n/);
 if(!create || !data)throw new Error('Expected legacy table and INSERT statement not found');
 const rows=data[1].trim().split('\n').map(line=>line.trim().replace(/,$/,''));
 if(rows.length!==16164 || rows.some(r=>!/^\(\d+,/.test(r)||!r.endsWith(')')))throw new Error('Unexpected legacy backup shape');
 console.log(JSON.stringify({sourceRows:rows.length,sourceSha256:crypto.createHash('sha256').update(sql).digest('hex'),apply:process.argv.includes('--apply')}));
 if(!process.argv.includes('--apply'))return;
 const pool=database();const c=await pool.getConnection();let locked=false;let transaction=false;
 try{
  const [[lock]]=await c.query("SELECT GET_LOCK('salary_dart_import',10) AS acquired");if(Number(lock.acquired)!==1)throw new Error('Another import is in progress');locked=true;
  const [tls]=await c.query("SHOW STATUS LIKE 'Ssl_cipher'");if(!tls[0]?.Value)throw new Error('TLS is required');
  const [tables]=await c.query('SHOW TABLES');
  if(tables.length)throw new Error('Target is no longer empty; refusing to overwrite any table');
  const backup=path.resolve('var/backups');fs.mkdirSync(backup,{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(backup,'before-legacy-restore.json'),JSON.stringify({at:new Date().toISOString(),tables,sourceSha256:crypto.createHash('sha256').update(sql).digest('hex')},null,2),{mode:0o600,flag:'wx'});
  await c.query("SET SESSION sql_mode='NO_AUTO_VALUE_ON_ZERO,STRICT_ALL_TABLES'");
  await c.query(create);
  await c.beginTransaction();transaction=true;
  for(let i=0;i<rows.length;i+=500){await c.query('INSERT INTO salary_data VALUES '+rows.slice(i,i+500).join(',\n'));if(i%2500===0)console.log('Restored',Math.min(i+500,rows.length),'/',rows.length);}
  const [[count]]=await c.query('SELECT COUNT(*) AS total FROM salary_data');if(Number(count.total)!==rows.length)throw new Error('Restore count mismatch');
  const [years]=await c.query('SELECT fiscal_year,COUNT(*) AS rows_count FROM salary_data GROUP BY fiscal_year ORDER BY fiscal_year');
  await c.commit();transaction=false;console.log(JSON.stringify({restored:count.total,years}));
 }catch(e){if(transaction)await c.rollback();throw e;}finally{if(locked)await c.query("SELECT RELEASE_LOCK('salary_dart_import')");c.release();await pool.end();}
}
main().catch(e=>{console.error('Restore failed:',e.code||e.message);process.exitCode=1;});
