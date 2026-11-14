(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SalaryNewsSearch=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function cleanPosition(value){
  return String(value??'').normalize('NFKC')
   .replace(/(?:주|註)\s*\d+\s*[)）.:]?/g,' ')
   .replace(/[\[({（【]\s*\d+\s*[\])}）】]/g,' ')
   .replace(/[※＊*†‡]+\s*\d*/g,' ')
   .replace(/前/g,'전')
   .replace(/[^\p{L}\p{N}\s]/gu,' ')
   .replace(/\s+/g,' ').trim();
 }
 function newsURL(row){
  const query=[row.employee_name,row.company_name,cleanPosition(row.position_name)].filter(Boolean).join(' ');
  return 'https://search.naver.com/search.naver?where=news&query='+encodeURIComponent(query);
 }
 return {cleanPosition,newsURL};
});
