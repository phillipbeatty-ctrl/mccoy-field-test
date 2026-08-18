import twilio from 'twilio';
import { applySmsCommand, insertAudit, requireEnv } from './_lib.mjs';

function exactWebhookUrl(req){
  if(process.env.TWILIO_WEBHOOK_URL) return process.env.TWILIO_WEBHOOK_URL;
  const proto=req.headers['x-forwarded-proto']||'https';
  const host=req.headers['x-forwarded-host']||req.headers.host;
  return `${proto}://${host}${req.url}`;
}

export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).send('Method Not Allowed');
  try{
    const authToken=requireEnv('TWILIO_AUTH_TOKEN');
    const signature=req.headers['x-twilio-signature']||'';
    const params=req.body||{};
    const valid=twilio.validateRequest(authToken,String(signature),exactWebhookUrl(req),params);
    const from=String(params.From||'').trim();
    const body=String(params.Body||'').trim();
    const messageSid=String(params.MessageSid||'').trim()||null;
    if(!valid){
      await insertAudit({direction:'inbound',from_number:from,message_body:body,provider_message_sid:messageSid,signature_valid:false,metadata:{reason:'invalid_twilio_signature'}});
      return res.status(403).type('text/plain').send('Forbidden');
    }
    const allowed=String(requireEnv('MCCOY_ADMIN_MOBILE')).trim();
    if(from!==allowed){
      await insertAudit({direction:'inbound',from_number:from,message_body:body,provider_message_sid:messageSid,signature_valid:true,metadata:{reason:'unauthorized_sender'}});
      return res.status(403).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response><Message>McCoy Dev: sender not authorized.</Message></Response>');
    }
    const result=await applySmsCommand({from,body,messageSid});
    const replies={PASS:'Test marked PASS.',FAIL:'Test marked FAIL.',RETEST:'Test queued for RETEST.',BUILD_NEXT:'BUILD NEXT approved.',PAUSE_DEV:'Development queue paused.',NOTE:'Note recorded for review.'};
    const reply=replies[result.command]||'Command recorded.';
    return res.status(200).type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>McCoy Dev: ${reply}</Message></Response>`);
  }catch(e){
    console.error('sms-command',e);
    return res.status(500).type('text/plain').send('Server Error');
  }
}
