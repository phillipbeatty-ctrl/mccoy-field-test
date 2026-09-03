Deno.serve(()=>Response.json({error:'endpoint_retired',replacement:'auth-email-provider-webhook'},{status:410,headers:{'Cache-Control':'no-store'}}))
