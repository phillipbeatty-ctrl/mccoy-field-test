import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  return Response.json(
    { error: 'recovery_endpoint_disabled', detail: 'The one-time attached SPOTIO recovery has completed and this endpoint is closed.' },
    { status: 410, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } },
  )
})
