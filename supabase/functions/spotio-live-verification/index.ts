Deno.serve(()=>Response.json({error:'verification_endpoint_retired'},{status:410,headers:{'Cache-Control':'no-store'}}))
