require('dotenv').config();const fs=require('fs');const zlib=require('zlib');const path=require('path');const assert=require('assert/strict');const {database}=require('../lib/db');
(async()=>{const p=database();try{
 const [years]=await p.query('SELECT fiscal_year,COUNT(*) AS rows_count FROM salary_data GROUP BY fiscal_year ORDER BY fiscal_year');
 const backup=fs.readdirSync('var/backups').filter(f=>f.startsWith('salary-before-dart-')).sort()[0];
 const baseline=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join('var/backups',backup))));
 const [legacy]=await p.query('SELECT * FROM salary_data WHERE fiscal_year IN (2021,2022,2023) ORDER BY id');assert.deepEqual(legacy,baseline.rows);
 const [[sources]]=await p.query('SELECT COUNT(*) AS total FROM salary_dart_sources');assert.equal(Number(sources.total),5255);
 const [[orphans]]=await p.query('SELECT COUNT(*) AS total FROM salary_dart_sources x LEFT JOIN salary_data s ON s.id=x.salary_id WHERE s.id IS NULL');assert.equal(Number(orphans.total),0);
 const [duplicates]=await p.query('SELECT company_name,fiscal_year,employee_name,position_name,compensation,COUNT(*) AS n FROM salary_data WHERE fiscal_year IN (2024,2025) GROUP BY company_name,fiscal_year,employee_name,position_name,compensation HAVING COUNT(*)>1');assert.equal(duplicates.length,0);
 const [unitChecks]=await p.query("SELECT company_name,fiscal_year,employee_name,compensation FROM salary_data WHERE (company_name='제일일렉트릭' AND fiscal_year=2024) OR (company_name='네오이뮨텍' AND fiscal_year IN (2024,2025)) ORDER BY company_name,fiscal_year,employee_name");
 const report={verifiedAt:new Date().toISOString(),years,legacyUnchanged:true,newSourceRows:Number(sources.total),newExactDuplicates:duplicates.length,orphanSources:Number(orphans.total),unitChecks};
 fs.writeFileSync('var/dart/db-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await p.end();}})().catch(e=>{console.error('Verification failed:',e.code||e.message);process.exitCode=1;});
