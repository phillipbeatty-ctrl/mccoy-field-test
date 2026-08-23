import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

// Compatibility endpoint for existing McCoy clients. The database RPC is the
// sole ranking authority; this function performs no independent calculation.
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const authorization=req.headers.get('Authorization')||''
    if(!/^Bearer\s+\S+/i.test(authorization))return Response.json({error:'unauthorized'},{status:401,headers:corsHeaders})
    const client=createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      {global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}}
    )
    const {data,error}=await client.rpc('get_verified_sales_rankings')
    if(error)throw error
    if(!data?.ok)throw new Error('rankings_unavailable')
    return Response.json(data,{headers:{...corsHeaders,'Cache-Control':'no-store'}})
  }catch(error){
    console.error('Authoritative ranking lookup failed',error)
    return Response.json({error:'leaders_failed'},{status:500,headers:corsHeaders})
  }
})
