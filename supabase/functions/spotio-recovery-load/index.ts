Deno.serve(()=>Response.json({error:'recovery_endpoint_retired'},{status:410,headers:{'Cache-Control':'no-store'}}))
