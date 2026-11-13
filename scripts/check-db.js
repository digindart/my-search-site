require('dotenv').config();
const {database}=require('../lib/db');
async function main(){const pool=database();try{
 const [tls]=await pool.query("SHOW STATUS LIKE 'Ssl_cipher'");
 if(!tls[0]?.Value)throw new Error('Encrypted DB connection required');
 const [columns]=await pool.query('SHOW COLUMNS FROM salary_data');
 const [counts]=await pool.query('SELECT fiscal_year, COUNT(*) AS rows_count FROM salary_data GROUP BY fiscal_year ORDER BY fiscal_year');
 const [tables]=await pool.query("SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='salary_data'");
 console.log(JSON.stringify({tls:true,columns:columns.map(c=>c.Field),years:counts,engine:tables[0]?.ENGINE}));
}finally{await pool.end();}}
main().catch(e=>{console.error('DB check failed:',e.code||e.message);process.exitCode=1;});
