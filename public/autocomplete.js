(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(root);else root.PayInsightAutocomplete=factory(root);})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 function attach(options){
  const input=options.input,list=options.list,doc=input.ownerDocument;
  const fetcher=options.fetch||root.fetch.bind(root),schedule=options.setTimeout||root.setTimeout.bind(root),cancelTimer=options.clearTimeout||root.clearTimeout.bind(root);
  let timer,sequence=0,composing=false,active=-1,controller,names=[];
  list.id=list.id||'company-suggestions';list.setAttribute('role','listbox');
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
  function clear(){names=[];active=-1;list.replaceChildren();list.style.display='none';input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
  function dismiss(){sequence++;cancelTimer(timer);if(controller)controller.abort();clear();}
  function choose(index){const name=names[index];if(!name)return;input.value=name;input.focus();dismiss();if(options.onSelect)options.onSelect(name);}
  function highlight(index){active=index;Array.from(list.children).forEach((item,i)=>item.setAttribute('aria-selected',String(i===index)));if(index>=0){input.setAttribute('aria-activedescendant',list.children[index].id);if(list.children[index].scrollIntoView)list.children[index].scrollIntoView({block:'nearest'});}}
  async function load(){
   const company=input.value.trim(),id=++sequence;if([...company].length<2){clear();return;}
   if(controller)controller.abort();controller=new AbortController();
   try{const response=await fetcher('/api/suggest?company='+encodeURIComponent(company),{signal:controller.signal});if(!response.ok)throw new Error('suggestion request failed');const data=await response.json();
    if(id!==sequence||company!==input.value.trim())return;
    clear();if(!Array.isArray(data))return;names=data.filter(n=>typeof n==='string').slice(0,50);
    names.forEach((name,index)=>{const item=doc.createElement('div');item.className='suggestion-item';item.id=list.id+'-'+index;item.textContent=name;item.setAttribute('role','option');item.setAttribute('aria-selected','false');item.addEventListener('mousedown',e=>e.preventDefault());item.addEventListener('click',()=>choose(index));list.appendChild(item);});
    if(names.length){list.style.display='block';input.setAttribute('aria-expanded','true');}
   }catch(error){if(id===sequence)clear();}
  }
  function queue(){dismiss();if([...input.value.trim()].length>=2)timer=schedule(load,options.delay??100);}
  function compositionUpdate(){dismiss();timer=schedule(load,options.delay??100);}
  function compositionStart(){composing=true;dismiss();}
  function compositionEnd(){composing=false;queue();}
  function keydown(event){
   if(composing||event.isComposing||event.keyCode===229)return;
   if(event.key==='Escape'){dismiss();return;}
   if(!names.length)return;
   if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();highlight(event.key==='ArrowDown'?(active+1)%names.length:(active<0?names.length-1:(active-1+names.length)%names.length));}
   else if(event.key==='Enter'&&active>=0){event.preventDefault();choose(active);}
  }
  function outside(event){if(event.target!==input&&!list.contains(event.target))dismiss();}
  const handlers={input:queue,focus:queue,compositionstart:compositionStart,compositionupdate:compositionUpdate,compositionend:compositionEnd,keydown};
  Object.entries(handlers).forEach(([name,handler])=>input.addEventListener(name,handler));doc.addEventListener('click',outside);
  return {dismiss,destroy(){dismiss();Object.entries(handlers).forEach(([name,handler])=>input.removeEventListener(name,handler));doc.removeEventListener('click',outside);}};
 }
 return {attach};
});
