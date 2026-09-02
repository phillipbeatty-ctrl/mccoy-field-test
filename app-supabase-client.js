// One browser-wide resolver for the Supabase client created by app-part1.js.
// Classic scripts share the global lexical `sb` binding, but top-level `const sb`
// is intentionally not a window property. Runtime modules must resolve it here
// instead of assuming window.sb exists.
(()=>{
  if(window.MCCOY_GET_SUPABASE_CLIENT)return;

  let cachedClient=null;

  function lexicalClient(){
    try{
      if(typeof sb!=='undefined'&&sb)return sb;
    }catch(_){}
    return null;
  }

  function supports(client,requirements={}){
    if(!client)return false;
    if(requirements.auth&&typeof client.auth?.getSession!=='function')return false;
    if(requirements.functions&&typeof client.functions?.invoke!=='function')return false;
    if(requirements.storage&&typeof client.storage?.from!=='function')return false;
    if(requirements.rpc&&typeof client.rpc!=='function')return false;
    return true;
  }

  function resolve(requirements={}){
    const candidates=[cachedClient,lexicalClient(),window.sb];
    for(const candidate of candidates){
      if(!supports(candidate,requirements))continue;
      cachedClient=candidate;
      return candidate;
    }
    return null;
  }

  window.MCCOY_GET_SUPABASE_CLIENT=resolve;
  window.MCCOY_REQUIRE_SUPABASE_CLIENT=requirements=>{
    const client=resolve(requirements);
    if(!client)throw new Error('McCoy connection is not ready. Refresh Field Coach and retry.');
    return client;
  };
})();
