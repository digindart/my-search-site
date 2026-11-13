require('dotenv').config();
const express = require('express');
const path = require('path');
const {database} = require('./lib/db');
const {categories, esc, layout, categoryPage} = require('./lib/pages');
const {needsReview} = require('./lib/quality');
const app = express();
app.disable('x-powered-by');
app.use((req,res,next) => {res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','strict-origin-when-cross-origin');next();});
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
function yearParam(req) {
 const year=String(req.query.year || '');
 if(year && !/^(19|20)\d{2}$/.test(year)) {const e=new Error('올바른 사업연도를 선택해주세요.');e.status=400;throw e;}
 return year;
}
const fields='company_name, fiscal_year, employee_name, position_name, compensation';
app.get('/api/suggest', asyncRoute(async(req,res) => {
 const company=String(req.query.company || '').trim().slice(0,255);
 if(company.length<2)return res.json([]);
 const [rows]=await database().execute(`SELECT DISTINCT company_name FROM salary_data WHERE company_name LIKE ? ESCAPE '!' ORDER BY company_name LIMIT 5`,[`%${company.replace(/[!%_]/g,'!$&')}%`]);
 res.json(rows.map(r=>r.company_name));
}));
app.get('/api/search',asyncRoute(async(req,res)=>{
 const company=String(req.query.company || '').trim(); const year=yearParam(req);
 if(!company)return res.json([]);
 if(company.length>255)return res.status(400).json({error:'회사명이 너무 깁니다.'});
 const params=[company];let sql=`SELECT DISTINCT ${fields} FROM salary_data WHERE company_name = ?`;
 if(year){sql+=' AND fiscal_year = ?';params.push(Number(year));}
 sql+=req.query.sort==='salary'?' ORDER BY compensation DESC, fiscal_year DESC, employee_name':' ORDER BY fiscal_year DESC, compensation DESC, employee_name';
 const [rows]=await database().execute(sql,params);res.json(rows.map(row=>({...row,review_required:needsReview(row)})));
}));
app.get('/api/years',asyncRoute(async(req,res)=>{const [rows]=await database().query('SELECT DISTINCT fiscal_year FROM salary_data ORDER BY fiscal_year DESC');res.json(rows.map(r=>r.fiscal_year));}));
app.get('/rankings', (req,res)=>res.send(layout('업권·그룹별 보수 순위','증권사, 보험사, 은행과 주요 그룹의 공시 보수총액을 비교하고 해석 기준을 확인하세요.','/rankings',`<p class="eyebrow">PAY INSIGHT / RANKINGS</p><h1>공시 보수, 맥락과 함께 읽기</h1><p class="lead">사업보고서에 공개된 개인별 보수총액을 업권과 그룹별로 살펴보세요. 평균 연봉이 아닌 공시 대상자의 지급 보수 순위입니다.</p><div class="cards">${categories.map(c=>`<a class="card" href="/rankings/${c.slug}"><h2>${esc(c.title)}</h2><p>${esc(c.description)}</p><span>순위 살펴보기 →</span></a>`).join('')}</div><h2>비교 전에 확인하세요</h2><p>퇴직금, 상여, 주식 보상은 연간 지급액에 큰 영향을 줄 수 있습니다. 같은 사업연도와 법인을 기준으로 비교하고, 원본 공시의 산정 기준을 함께 확인하세요.</p><a href="/methodology">수집·정제 기준 읽기 →</a>`)));
app.get('/rankings/:slug',asyncRoute(async(req,res)=>{
 const category=categories.find(c=>c.slug===req.params.slug);if(!category)return res.status(404).send('페이지를 찾을 수 없습니다.');
 const marks=category.companies.map(()=>'?').join(',');
 const [ys]=await database().execute(`SELECT DISTINCT fiscal_year FROM salary_data WHERE company_name IN (${marks}) ORDER BY fiscal_year DESC`,category.companies);
 const years=ys.map(r=>r.fiscal_year);const year=yearParam(req)||years[0];let rows=[];
 if(year){[rows]=await database().execute(`SELECT DISTINCT ${fields} FROM salary_data WHERE company_name IN (${marks}) AND fiscal_year=? AND compensation > 0 AND employee_name NOT IN ('-','') ORDER BY compensation DESC, company_name, employee_name`,[...category.companies,Number(year)]);}
 const pending=rows.filter(needsReview);
 res.send(categoryPage(category,year,years,rows.filter(r=>!needsReview(r)),pending.length));
}));
app.get('/methodology',(req,res)=>res.send(layout('자료 출처와 정제 기준','공시 보수와 연봉의 차이, 수집 범위, 단위와 정제 원칙을 설명합니다.','/methodology',`<h1>자료 출처와 정제 기준</h1><h2>무엇을 보여주나요?</h2><p>금융감독원 DART 사업보고서에 공개된 개인별 보수총액입니다. 기본급만을 뜻하는 연봉, 모든 직원의 평균 급여와는 다릅니다. OpenDART 신규 수집은 ‘개인별 보수지급 금액(5억 이상 상위 5인)’ API와 사업보고서 코드 11011을 사용합니다.</p><h2>사업연도와 제출연도</h2><p>2025년 자료는 2025 사업연도를 뜻합니다. 통상 그 다음 해 제출된 사업보고서에서 확인합니다. 정정 보고서와 수집 시점에 따라 내용이 달라질 수 있습니다.</p><h2>원 단위로 통일</h2><p>저장 및 다운로드 금액은 원 단위 정수입니다. 수집 원문과 단위, 공시 접수번호를 함께 보관합니다. 단위가 불분명하거나 큰 이상치가 발견되면 검토 대상으로 분리하며 추측으로 배수를 적용하지 않습니다. 기존 2021~2023 자료에는 단위 이상치가 의심되는 값이 있어 원문 대조가 필요합니다. 음수 또는 1,000억 원을 초과한 값은 확인이 필요한 검토 대상으로 분리해 순위에서 제외합니다. 높은 금액 자체가 오류라는 뜻은 아닙니다. 기업 검색에서는 검토 중임을 표시하며 다운로드에는 원본 금액과 검토 상태를 함께 제공합니다.</p><h2>성명과 직위 정리</h2><p>유니코드 표기와 공백, 줄바꿈, 명확한 주석 번호만 정리합니다. 전직·퇴임·겸직 등 의미 있는 정보는 유지합니다. 오타를 추정해 직급이나 인물을 바꾸지 않으며, 개별 수정은 원문 근거와 변경 사유를 남깁니다.</p><h2>누락과 중복</h2><p>미공개는 0원이 아닙니다. 같은 회사·연도·이름·직위·금액이 일치하는 행은 표시할 때 중복을 제거합니다. 동일 인물의 여러 회사 보수는 서로 다른 지급 내역이므로 합산하지 않습니다. 업권 및 그룹은 페이지에 명시한 선정 회사 목록 기준이며 전체 계열사 또는 과거 계열 관계를 보장하지 않습니다.</p><h2>출처 확인과 정정</h2><p>원본은 <a href="https://dart.fss.or.kr/">DART 전자공시</a>에서 회사와 사업연도로 검색할 수 있습니다. 신규 수집 자료의 접수번호는 적재 이력에 보관합니다. 오류 제보 시 회사명·사업연도·성명과 공시 접수번호를 <a href="https://github.com/digindart/my-search-site/issues">프로젝트 이슈</a>로 알려주세요. 계정 비밀번호나 비공개 개인정보는 올리지 마세요.</p>`)));
app.get('/privacy',(req,res)=>res.send(layout('개인정보 안내','검색 서비스의 정보 처리와 외부 링크 안내입니다.','/privacy','<h1>개인정보 안내</h1><p>이 서비스에는 회원가입 기능이 없습니다. 검색어는 조회를 위해 서버로 전달됩니다. 서버 및 호스팅 제공자가 접속 기록을 처리할 수 있습니다.</p><p>더 알아보기 버튼을 누르면 성명, 회사명, 직위, 연도가 네이버 뉴스 검색으로 전달됩니다. 외부 사이트에는 해당 서비스의 개인정보 처리방침이 적용됩니다.</p><p>현재 신규 순위·해설 페이지에는 광고를 게재하지 않습니다. 검색 화면의 Google 광고 스크립트도 콘텐츠 검토가 완료될 때까지 제거했습니다.</p>')));
app.get('/sitemap.xml',(req,res)=>res.type('xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/','/rankings','/methodology','/privacy',...categories.map(c=>'/rankings/'+c.slug)].map(p=>`<url><loc>https://salaryinsight.co.kr${p}</loc></url>`).join('')}</urlset>`));
app.get('/robots.txt',(req,res)=>res.type('text').send('User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://salaryinsight.co.kr/sitemap.xml\n'));
app.use(express.static(path.join(__dirname,'public')));
app.use((error,req,res,next)=>{console.error('Request failed:',error.code || error.status || 'INTERNAL'); const status=error.status||503;if(req.path.startsWith('/api/'))return res.status(status).json({error:status===400?error.message:'자료를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'});res.status(status).send(layout('자료 조회 안내','자료 조회 상태 안내',req.path,'<h1>자료를 불러오지 못했습니다</h1><p>잠시 후 다시 시도해주세요. 자료가 없는 상태를 0원으로 해석하지 마세요.</p>',true));});
if(require.main===module)app.listen(process.env.PORT||3000,()=>console.log('PAY INSIGHT started'));
module.exports=app;
