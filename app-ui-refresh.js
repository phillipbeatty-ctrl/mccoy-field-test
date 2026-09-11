// Shared refresh primitives. Requests in the same burst share one result; an
// update arriving during a request gets one fresh pass after that request ends.
(()=>{
  if(window.MCCOY_UI)return;
  const rendered=new WeakMap();
  function changed(node,value){
    if(!node)return false;
    const signature=typeof value==='string'?value:JSON.stringify(value);
    if(rendered.get(node)===signature)return false;
    rendered.set(node,signature);return true;
  }
  function text(node,value){if(node&&node.textContent!==String(value))node.textContent=String(value);}
  // Use only for read-only subtrees. Editable controls keep their own nodes.
  function html(node,value){if(changed(node,value))node.innerHTML=value;}
  function coalesceRefresh(task){
    let next=null,running=false,scheduled=false;
    function schedule(){
      if(running||scheduled||!next)return;
      scheduled=true;setTimeout(flush,0);
    }
    async function flush(){
      scheduled=false;const batch=next;if(!batch)return;
      next=null;running=true;
      try{batch.resolve(await task(...batch.args));}
      catch(error){batch.reject(error);}
      finally{running=false;schedule();}
    }
    return(...args)=>{
      if(!next){
        next={args};
        next.promise=new Promise((resolve,reject)=>{next.resolve=resolve;next.reject=reject;});
      }else next.args=args;
      const promise=next.promise;schedule();return promise;
    };
  }
  const backgroundTasks=new Set();let backgroundTimer=null;
  function runBackgroundRefresh(){
    if(document.hidden||!window.MCCOY_ACCESS?.user)return;
    for(const task of backgroundTasks)task();
  }
  function backgroundRefresh(task){
    backgroundTasks.add(task);
    if(backgroundTimer===null)backgroundTimer=setInterval(runBackgroundRefresh,60000);
  }
  document.addEventListener('visibilitychange',runBackgroundRefresh);
  window.addEventListener('beforeunload',()=>{if(backgroundTimer!==null)clearInterval(backgroundTimer);});
  window.MCCOY_UI={changed,text,html,coalesceRefresh,backgroundRefresh};
})();
