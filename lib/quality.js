// A review gate, not an assertion that a high payment is wrong. Never rescale by magnitude.
function needsReview(row) {
 if(row.compensation == null)return false;
 try {const amount=BigInt(row.compensation);return amount<0n || amount>100000000000n;} catch{return true;}
}
function isMaskedName(name){return /[○●〇*]|[OX]{2,}/.test(String(name||''));}
module.exports={needsReview,isMaskedName};
