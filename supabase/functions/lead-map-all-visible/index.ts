Deno.serve(()=>Response.json({error:'one_time_operation_retired'},{status:410,headers:{'Cache-Control':'no-store'}}))
