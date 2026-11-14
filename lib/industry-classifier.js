// Custom PAY/SALARY INSIGHT taxonomy mapped to official KSIC 10/11 codes.
// A broad parent spanning different categories is deliberately not classified.
const rules=[
 ['66121','SECURITIES'],['6412','BANKING'],['64132','BANKING'],
 ['651','INSURANCE'],['652','INSURANCE'],
 ['642','OTHER_FINANCE'],['6491','OTHER_FINANCE'],['64991','OTHER_FINANCE'],['64999','OTHER_FINANCE'],['6611','OTHER_FINANCE'],['6619','OTHER_FINANCE'],['662','OTHER_FINANCE'],
 ['64992',null],['261','SEMICONDUCTOR'],['29271','SEMICONDUCTOR'],
 ['26','ELECTRONICS'],['28','ELECTRONICS'],['29272','ELECTRONICS'],
 ['30','AUTOMOTIVE'],['28202','BATTERY'],['28209','BATTERY'],
 ['19','CHEMICAL'],['20','CHEMICAL'],['20422','RETAIL'],['20423','RETAIL'],
 ['24','STEEL'],['25','STEEL'],['252',null],
 ['311','SHIPBUILDING'],['29','SHIPBUILDING'],
 ['41','CONSTRUCTION'],['42','CONSTRUCTION'],['68','CONSTRUCTION'],
 ['21','BIO_PHARMA'],['70113','BIO_PHARMA'],['46441','BIO_PHARMA'],
 ['62','IT_INTERNET'],['63','IT_INTERNET'],['63992',null],['5822','IT_INTERNET'],
 ['581','GAME_CONTENT'],['5821','GAME_CONTENT'],['59','GAME_CONTENT'],['60','GAME_CONTENT'],['90','GAME_CONTENT'],
 ['61','TELECOM'],['47','RETAIL'],['464','RETAIL'],['14','RETAIL'],['15','RETAIL'],['32','RETAIL'],
 ['10','FOOD'],['11','FOOD'],['56','FOOD'],['463','FOOD'],
 ['49','TRANSPORT'],['50','TRANSPORT'],['51','TRANSPORT'],['52','TRANSPORT'],['35','ENERGY']
];
function classifyIndustry(code){
 code=String(code||'').trim();if(!/^\d{2,5}$/.test(code))return null;
 const ancestors=rules.filter(([prefix])=>code.startsWith(prefix)).sort((a,b)=>b[0].length-a[0].length);
 if(!ancestors.length)return null;
 const selected=ancestors[0][1];if(!selected)return null;
 // E.g. 26 may mean semiconductor OR electronics; 292 may mean machines OR semiconductor equipment.
 if(rules.some(([prefix,category])=>prefix.startsWith(code)&&category!==selected))return null;
 return selected;
}
module.exports={classifyIndustry,rules};
