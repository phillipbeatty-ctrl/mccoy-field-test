export const PRODUCTION_PROJECT_REF='athxxrfqxwlfnuvbqadp';
export const PRODUCTION_BACKEND_URL=`https://${PRODUCTION_PROJECT_REF}.supabase.co`;
export const PRODUCTION_PUBLIC_KEY='sb_publishable_UB8C4-fhWPLpba6xta6EKg_hBtZC2iT';
export const PRODUCTION_APP_HOSTS=[
  'mccoy-field-test-git-main-phillipbeatty-6762s-projects.vercel.app',
  'mccoy-field-test-phillipbeatty-6762s-projects.vercel.app',
  'mccoy-field-test.vercel.app','www.mccoyplatform.com','mccoyplatform.com'
];

// Only Vercel's deployment environment selects production. There is deliberately
// no fallback from an unconfigured Preview to the live project's public key.
export function backendEnvironment(env){
  const environment=env.VERCEL_ENV;
  if(environment==='production'){
    if(env.SUPABASE_URL&&env.SUPABASE_URL!==PRODUCTION_BACKEND_URL){
      throw new Error('production_backend_mismatch');
    }
    return {environment,projectRef:PRODUCTION_PROJECT_REF,url:PRODUCTION_BACKEND_URL,
      publicKey:PRODUCTION_PUBLIC_KEY,appOrigin:'https://mccoy-field-test.vercel.app'};
  }
  if(environment!=='preview'&&environment!=='development')throw new Error('deployment_environment_required');
  const url=String(env.MCCOY_PREVIEW_SUPABASE_URL||'');
  const match=/^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(url);
  if(!match)throw new Error('preview_backend_url_required');
  if(match[1]===PRODUCTION_PROJECT_REF)throw new Error('preview_cannot_use_production_backend');
  const publicKey=String(env.MCCOY_PREVIEW_SUPABASE_PUBLISHABLE_KEY||'');
  if(!/^sb_publishable_[A-Za-z0-9_-]{20,120}$/.test(publicKey))throw new Error('preview_publishable_key_required');
  if(publicKey===PRODUCTION_PUBLIC_KEY)throw new Error('preview_cannot_use_production_key');
  const hostname=String(env.VERCEL_URL||'');
  if(!/^[a-z0-9-]+\.vercel\.app$/.test(hostname)||PRODUCTION_APP_HOSTS.includes(hostname)){
    throw new Error('preview_deployment_hostname_required');
  }
  return {environment,projectRef:match[1],url,publicKey,appOrigin:`https://${hostname}`};
}

export function replaceDeploymentReferences(source,backend){
  if(backend.environment==='production')return source;
  let result=source.replaceAll(PRODUCTION_BACKEND_URL,backend.url)
    .replaceAll(`wss://${PRODUCTION_PROJECT_REF}.supabase.co`,`wss://${backend.projectRef}.supabase.co`)
    .replaceAll(`${PRODUCTION_PROJECT_REF}.supabase.co`,`${backend.projectRef}.supabase.co`)
    .replaceAll(PRODUCTION_PUBLIC_KEY,backend.publicKey);
  // Password recovery, signup confirmation, and UPDATE APP must also stay on
  // the isolated frontend. Rewriting the backend URL alone is insufficient.
  for(const host of PRODUCTION_APP_HOSTS)result=result.replaceAll(host,new URL(backend.appOrigin).hostname);
  return result;
}
