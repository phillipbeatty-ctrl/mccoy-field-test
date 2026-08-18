import { createClient } from '@supabase/supabase-js';

export function requireEnv(name){
  const v=process.env[name];
  if(!v) throw new Error(`missing_env:${name}`);
  return v;
}

export function adminDb(){
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth:{persistSession:false,autoRefreshToken:false}
  });
}

export async function insertAudit(row){
  const db=adminDb();
  const {error}=await db.from('mccoy_sms_audit').insert(row);
  if(error) console.error('sms audit insert failed',error);
}

export async function latestQueue(){
  const db=adminDb();
  const {data,error}=await db.from('mccoy_dev_queue').select('*').order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error) throw error;
  return data;
}

export function normalizeCommand(body=''){
  const raw=String(body||'').trim();
  const upper=raw.toUpperCase();
  if(/^PASS\b/.test(upper)) return {command:'PASS',notes:raw.replace(/^PASS\b/i,'').trim()};
  if(/^FAIL\b/.test(upper)) return {command:'FAIL',notes:raw.replace(/^FAIL\b/i,'').trim()};
  if(/^RETEST\b/.test(upper)) return {command:'RETEST',notes:raw.replace(/^RETEST\b/i,'').trim()};
  if(/^BUILD NEXT\b/.test(upper)) return {command:'BUILD_NEXT',notes:raw.replace(/^BUILD NEXT\b/i,'').trim()};
  if(/^PAUSE DEV\b/.test(upper)) return {command:'PAUSE_DEV',notes:raw.replace(/^PAUSE DEV\b/i,'').trim()};
  if(/^NOTE\b/.test(upper)) return {command:'NOTE',notes:raw.replace(/^NOTE\b/i,'').trim()};
  return {command:'NOTE',notes:raw};
}

export async function applySmsCommand({from,body,messageSid}){
  const db=adminDb();
  const latest=await latestQueue();
  const {command,notes}=normalizeCommand(body);
  let queueId=latest?.id||null;

  if(command==='PASS' && latest){
    await db.from('mccoy_dev_queue').update({status:'test_passed',test_result:'pass',test_notes:notes||latest.test_notes}).eq('id',latest.id);
  }else if(command==='FAIL' && latest){
    await db.from('mccoy_dev_queue').update({status:'test_failed',test_result:'fail',test_notes:notes||latest.test_notes}).eq('id',latest.id);
  }else if(command==='RETEST' && latest){
    await db.from('mccoy_dev_queue').update({status:'ready_for_test',test_result:null,test_notes:notes||latest.test_notes}).eq('id',latest.id);
  }else if(command==='BUILD_NEXT'){
    if(latest && ['test_passed','test_failed','ready_for_test','needs_review'].includes(latest.status)){
      await db.from('mccoy_dev_queue').update({status:'approved_to_build',approved_by:from,approved_at:new Date().toISOString(),test_notes:notes||latest.test_notes}).eq('id',latest.id);
    }else{
      const {data,error}=await db.from('mccoy_dev_queue').insert({app_target:'field-coach',request_type:'build_change',title:'Remote BUILD NEXT command',instructions:notes||'Implement the next safe queued development step.',status:'approved_to_build',requested_by:from,requested_from:'sms',approved_by:from,approved_at:new Date().toISOString()}).select('id').single();
      if(error) throw error; queueId=data.id;
    }
  }else if(command==='PAUSE_DEV'){
    await db.from('mccoy_dev_queue').update({status:'paused'}).in('status',['ready_for_test','approved_to_build','building','needs_review']);
  }else{
    const {data,error}=await db.from('mccoy_dev_queue').insert({app_target:latest?.app_target||'field-coach',request_type:'note',title:'Remote tester note',instructions:notes,status:'needs_review',requested_by:from,requested_from:'sms'}).select('id').single();
    if(error) throw error; queueId=data.id;
  }

  await insertAudit({direction:'inbound',from_number:from,message_body:body,command,queue_id:queueId,provider_message_sid:messageSid,signature_valid:true});
  return {command,queue_id:queueId};
}
