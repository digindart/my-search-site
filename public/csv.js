(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PayInsightCSV=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function escape(value){let text=value==null?'':String(value);if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
 function serialize(rows){return rows.map(row=>row.map(escape).join(',')).join('\r\n');}
 return {escape,serialize};
});
