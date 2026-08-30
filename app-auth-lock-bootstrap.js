// Install McCoy's bounded Supabase auth lock before app-part1 creates the client.
// Normal cross-tab locking is retained; only a lock acquisition that stalls is bypassed.
(()=>{
  if(window.MCCOY_AUTH_LOCK_BOOTSTRAP||!window.supabase?.createClient)return;
  window.MCCOY_AUTH_LOCK_BOOTSTRAP=true;
  const originalCreateClient=window.supabase.createClient.bind(window.supabase);
  const MAX_LOCK_WAIT_MS=4500;

  async function boundedAuthLock(name,acquireTimeout,fn){
    if(typeof fn!=='function')throw new TypeError('McCoy auth lock callback is required.');
    if(!navigator?.locks?.request)return fn();
    const requested=Number(acquireTimeout);
    const waitMs=Number.isFinite(requested)&&requested>0?Math.min(requested,MAX_LOCK_WAIT_MS):MAX_LOCK_WAIT_MS;
    const controller=new AbortController();
    let acquired=false;
    const timer=setTimeout(()=>{if(!acquired)controller.abort('mccoy_auth_lock_timeout');},waitMs);
    try{
      return await navigator.locks.request(name,{mode:'exclusive',signal:controller.signal},async()=>{
        acquired=true;
        clearTimeout(timer);
        return fn();
      });
    }catch(error){
      if(!controller.signal.aborted)throw error;
      console.warn('McCoy auth lock wait expired; continuing without the stale browser lock.');
      return fn();
    }finally{
      clearTimeout(timer);
    }
  }

  window.supabase.createClient=(url,key,options={})=>{
    const auth={...(options?.auth||{})};
    if(typeof auth.lock!=='function')auth.lock=boundedAuthLock;
    return originalCreateClient(url,key,{...(options||{}),auth});
  };
})();
