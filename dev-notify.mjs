import twilio from 'twilio';
import { adminDb, insertAudit, requireEnv } from './_lib.mjs';

function authorized(req){
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  return token && token===process.env.MCCOY_DEV_INTERNAL_TOKEN;
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'method_not_allowed'});
  if(!authorized(req)) return res.status(401).json({error:'unauthorized'});
  try{
    const db=adminDb();
    const queueId=req.body?.queue_id||null;
    let q=db.from('mccoy_dev_queue').select('*');
    if(queueId) q=q.eq('id',queueId).limit(1);
    else q=q.eq('status','ready_for_test').is('notified_at',null).order('created_at',{ascending:false}).limit(1);
    const {data,error}=await q.maybeSingle();
    if(error) throw error;
    if(!data) return res.status(404).json({error:'no_ready_test'});

    const sid=requireEnv('TWILIO_ACCOUNT_SID');
    const auth=requireEnv('TWILIO_AUTH_TOKEN');
    const from=requireEnv('TWILIO_FROM_NUMBER');
    const to=requireEnv('MCCOY_ADMIN_MOBILE');
    const client=twilio(sid,auth);
    const body=req.body?.message || `McCoy ${data.app_target}: ${data.title||'new test ready'}. ${data.instructions||''} ${data.deployed_url||''} Reply PASS, FAIL <note>, RETEST, BUILD NEXT, PAUSE DEV, or NOTE <text>.`;
    const message=await client.messages.create({from,to,body:body.slice(0,1500)});
    await db.from('mccoy_dev_queue').update({notified_at:new Date().toISOString(),notification_attempts:Number(data.notification_attempts||0)+1}).eq('id',data.id);
    await insertAudit({direction:'outbound',from_number:from,to_number:to,message_body:body,queue_id:data.id,provider_message_sid:message.sid,signature_valid:null});
    return res.status(200).json({ok:true,queue_id:data.id,message_sid:message.sid});
  }catch(e){
    console.error('dev-notify',e);
    return res.status(500).json({error:'notify_failed',detail:String(e?.message||e)});
  }
}
