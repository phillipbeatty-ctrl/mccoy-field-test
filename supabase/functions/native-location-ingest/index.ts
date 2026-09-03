// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
const hex=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('')

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return json({error:'method_not_allowed'},405)
  try{
    const url=new URL(req.url)
    const sessionId=String(url.searchParams.get('session_id')||'')
    const token=String(req.headers.get('x-mccoy-location-token')||'')
    if(!/^[0-9a-f-]{36}$/i.test(sessionId)||token.length<32)return json({error:'unauthorized'},401)

    const supabase=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
    const tokenHash=await hex(token)
    const {data:grant,error:grantError}=await supabase.from('native_location_sessions').select('session_id,user_id,organization_id,active,token_sha256').eq('session_id',sessionId).eq('active',true).maybeSingle()
    if(grantError)throw grantError
    if(!grant||grant.token_sha256!==tokenHash)return json({error:'unauthorized'},401)

    const {data:session,error:sessionError}=await supabase.from('test_sessions').select('id,tester_user_id,organization_id,ended_at').eq('id',sessionId).maybeSingle()
    if(sessionError)throw sessionError
    if(!session||session.ended_at||session.tester_user_id!==grant.user_id||session.organization_id!==grant.organization_id)return json({error:'session_not_open'},409)

    const body=await req.json().catch(()=>({}))
    const latitude=Number(body.latitude),longitude=Number(body.longitude),accuracy=Number(body.accuracy)
    if(!Number.isFinite(latitude)||latitude < -90||latitude > 90||!Number.isFinite(longitude)||longitude < -180||longitude > 180)return json({error:'invalid_coordinates'},400)
    if(!Number.isFinite(accuracy)||accuracy<0||accuracy>5000)return json({error:'invalid_accuracy'},400)
    const producedAt=Number(body.time)
    const eventTime=Number.isFinite(producedAt)&&producedAt>0?new Date(producedAt):new Date()
    if(Math.abs(Date.now()-eventTime.getTime())>24*60*60*1000)return json({error:'stale_location'},400)

    const payload={source:'native',simulated:body.simulated===true,bearing:Number.isFinite(Number(body.bearing))?Number(body.bearing):null,speed:Number.isFinite(Number(body.speed))?Number(body.speed):null,altitude:Number.isFinite(Number(body.altitude))?Number(body.altitude):null,native_received_at:new Date().toISOString(),organization_id:session.organization_id}
    const gpsVerified=body.simulated!==true&&accuracy<=35
    const gpsQuality=body.simulated===true?'Simulated':accuracy<=15?'Verified':accuracy<=30?'Acceptable':accuracy<=50?'Poor':'Unverified'

    const {error:insertError}=await supabase.from('test_events').insert({session_id:sessionId,organization_id:session.organization_id,event_type:'native_background_location',event_time:eventTime.toISOString(),latitude,longitude,accuracy_meters:accuracy,gps_fix_age_ms:Math.max(0,Date.now()-eventTime.getTime()),gps_quality:gpsQuality,is_gps_verified:gpsVerified,payload})
    if(insertError&&insertError.code!=='23505')throw insertError
    return json({ok:true,deduplicated:insertError?.code==='23505',organization_id:session.organization_id})
  }catch(error){
    console.error('native-location-ingest failed',String(error?.message||error))
    return json({error:'native_location_ingest_failed'},500)
  }
})