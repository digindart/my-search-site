const test=require('node:test'),assert=require('node:assert/strict');
const {classifyIndustry}=require('../lib/industry-classifier');
const categories=require('../data/industry-categories.json'),members=require('../data/industry-companies.json').companies;
test('ambiguous parent codes and general holdings remain unclassified',()=>{
 for(const code of ['26','28','282','292','582','649','6499','64992','204','25','701','7011','6612','661','invalid'])assert.equal(classifyIndustry(code),null,code);
});
test('specific codes override broad manufacturing/software categories',()=>{
 for(const [code,category] of [['2611','SEMICONDUCTOR'],['26299','ELECTRONICS'],['29271','SEMICONDUCTOR'],['29272','ELECTRONICS'],['29299','SHIPBUILDING'],['28202','BATTERY'],['28209','BATTERY'],['20423','RETAIL'],['201','CHEMICAL'],['58221','IT_INTERNET'],['58211','GAME_CONTENT'],['64121','BANKING'],['64913','OTHER_FINANCE'],['6511','INSURANCE']])assert.equal(classifyIndustry(code),category,code);
});
test('all 20 enabled categories have evidenced legal identities and no duplicate primary corporations',()=>{
 assert.equal(categories.length,20);assert(categories.every(c=>c.page_enabled&&members.some(m=>m.industry_code===c.code)));
 assert.equal(new Set(members.map(m=>m.corp_code)).size,members.length);
 for(const m of members){assert.equal(require('../data/industry-overrides.json').companies[m.corp_code]||classifyIndustry(m.ksic_code),m.industry_code);assert.match(m.evidence.response_sha256,/^[a-f0-9]{64}$/);assert.equal(m.valid_from_year,2024);}
});
