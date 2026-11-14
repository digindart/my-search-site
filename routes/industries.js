const express=require('express');const {database}=require('../lib/db');
const {createIndustryService}=require('../lib/industries');const {industryPage,industryIndex}=require('../lib/industry-pages');
const {layout,esc}=require('../lib/pages');const {serialize}=require('../public/csv');
function industryRoutes(service=createIndustryService(database)){
 const router=express.Router();const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(e=>{if(e.status===400)return res.status(400).send(layout('검색 조건 확인','업권 검색 조건을 확인해주세요.',req.path,`<h1>검색 조건을 확인해주세요</h1><p>${esc(e.message)}</p><a href="/industries">업권 안내로 돌아가기</a>`,true));next(e);});
 router.get('/industries',wrap(async(req,res)=>{const catalogue=await service.catalogue();const models=await Promise.all(catalogue.categories.filter(c=>c.page_enabled).map(c=>service.model(c.slug,{})));res.send(industryIndex(catalogue,models));}));
 router.get('/industries/:slug/export.csv',wrap(async(req,res)=>{const model=await service.model(req.params.slug,req.query);if(!model)return res.status(404).send('공개된 업권 페이지가 없습니다.');res.set('X-Robots-Tag','noindex');res.set('Content-Disposition',`attachment; filename="salary-insight-${model.category.slug}-${model.year??'no-data'}.csv"`);res.type('text/csv; charset=utf-8').send('\uFEFF'+serialize([['회사명','결산연도','이름','직위','보수총액(원)','DART 고유번호'],...model.filtered.map(r=>[r.company_name,r.fiscal_year,r.employee_name,r.position_name,r.compensation,r.corp_code])]));}));
 router.get('/industries/:slug',wrap(async(req,res)=>{const model=await service.model(req.params.slug,req.query);if(!model)return res.status(404).send(layout('업권 안내','이 업권은 아직 공개되지 않았습니다.',req.path,'<h1>공개된 업권 페이지가 없습니다</h1><a href="/industries">전체 업권 안내</a>',true));res.send(industryPage(model));}));
 return router;
}
module.exports={industryRoutes};
