import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { annotateEarnedPay, buildAccountingCsv, startOfWeekPacific } from '../_shared/accounting-records.mjs'

const json=(body:any,status=200)=>Response.json(body,{status,headers:{...corsHeaders,'Cache-Control':'no-store'}})
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/

function pacificMidnight(value:string){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null
  const [year,month,day]=value.split('-').map(Number),probe=new Date(Date.UTC(year,month-1,day,12))
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(probe)
  const get=(type:string)=>Number(parts.find(part=>part.type===type)?.value||0)
  const represented=Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'))
  const offset=represented-probe.getTime()
  return new Date(Date.UTC(year,month-1,day)-offset)
}

function addCalendarDays(value:string,days:number){
  const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));date.setUTCDate(date.getUTCDate()+days)
  return date.toISOString().slice(0,10)
}

function safeFilePart(value:string){return String(value||'all-reps').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'all-reps'}

async function loadSales(admin:any,{repEmail,from,to,limit=50000}:{repEmail?:string|null,from?:Date|null,to?:Date|null,limit?:number}){
  const rows:any[]=[]
  for(let page=0;page<Math.ceil(limit/1000);page++){
    let query=admin.from('sales_records').select('*').order('created_at',{ascending:true})
    if(repEmail)query=query.eq('rep_email',repEmail)
    if(from)query=query.gte('created_at',from.toISOString())
    if(to)query=query.lt('created_at',to.toISOString())
    const {data,error}=await query.range(page*1000,Math.min(limit-1,page*1000+999))
    if(error)throw error
    const batch=data||[];rows.push(...batch)
    if(batch.length<1000)return rows
  }
  if(rows.length>=limit)throw new Error('accounting_record_limit_exceeded')
  return rows
}

async function activeRule(admin:any){
  const {data,error}=await admin.from('compensation_rules').select('rule').eq('active',true).limit(1).maybeSingle()
  if(error)throw error
  return data?.rule||{}
}

function config(){
  const email=!!(Deno.env.get('RESEND_API_KEY')&&Deno.env.get('ACCOUNTING_FROM_EMAIL'))
  const onedrive=!!(Deno.env.get('MICROSOFT_TENANT_ID')&&Deno.env.get('MICROSOFT_CLIENT_ID')&&Deno.env.get('MICROSOFT_CLIENT_SECRET')&&Deno.env.get('ONEDRIVE_DRIVE_ID'))
  return {email,onedrive,onedrive_folder:Deno.env.get('ONEDRIVE_FOLDER_PATH')||'McCoy Accounting'}
}

function base64(bytes:Uint8Array){
  let binary='';const chunk=0x8000
  for(let index=0;index<bytes.length;index+=chunk)binary+=String.fromCharCode(...bytes.subarray(index,index+chunk))
  return btoa(binary)
}

async function sha256(bytes:Uint8Array){
  const digest=await crypto.subtle.digest('SHA-256',bytes)
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')
}

async function sendEmail(bytes:Uint8Array,fileName:string,to:string,recordCount:number,period:string,exportId:string){
  const key=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('ACCOUNTING_FROM_EMAIL')
  if(!key||!from)throw new Error('email_not_configured')
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Idempotency-Key':`mccoy-accounting-${exportId}`},body:JSON.stringify({
    from,to:[to],subject:`McCoy accounting records — ${period}`,
    html:`<p>Your requested McCoy accounting file is attached.</p><p>${recordCount} record${recordCount===1?'':'s'} · ${period}</p><p>This file contains confidential customer and accounting data. Store and share it only through approved company systems.</p>`,
    attachments:[{filename:fileName,content:base64(bytes)}]
  })})
  const result=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(`email_delivery_failed:${String(result?.message||response.status).slice(0,100)}`)
  return {external_id:result?.id||null}
}

async function uploadOneDrive(bytes:Uint8Array,fileName:string){
  const tenant=Deno.env.get('MICROSOFT_TENANT_ID'),clientId=Deno.env.get('MICROSOFT_CLIENT_ID'),secret=Deno.env.get('MICROSOFT_CLIENT_SECRET'),driveId=Deno.env.get('ONEDRIVE_DRIVE_ID')
  if(!tenant||!clientId||!secret||!driveId)throw new Error('onedrive_not_configured')
  const tokenResponse=await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:secret,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'})})
  const token=await tokenResponse.json().catch(()=>({}))
  if(!tokenResponse.ok||!token?.access_token)throw new Error('onedrive_auth_failed')
  const folder=(Deno.env.get('ONEDRIVE_FOLDER_PATH')||'McCoy Accounting').split('/').map(value=>value.trim()).filter(Boolean)
  let parentId:string|null=null,cumulative:string[]=[]
  for(const name of folder){
    cumulative.push(name)
    const lookupPath=cumulative.map(encodeURIComponent).join('/')
    const lookup=await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/root:/${lookupPath}`,{headers:{Authorization:`Bearer ${token.access_token}`}})
    if(lookup.ok){const existing=await lookup.json();parentId=existing?.id||null;continue}
    if(lookup.status!==404)throw new Error('onedrive_folder_lookup_failed')
    const children=parentId
      ?`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}/children`
      :`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/root/children`
    const create=await fetch(children,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({name,folder:{},'@microsoft.graph.conflictBehavior':'fail'})})
    const created=await create.json().catch(()=>({}))
    if(!create.ok||!created?.id)throw new Error('onedrive_folder_create_failed')
    parentId=created.id
  }
  const path=[...folder,fileName].map(encodeURIComponent).join('/')
  const upload=await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/root:/${path}:/content`,{method:'PUT',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'text/csv'},body:bytes})
  const item=await upload.json().catch(()=>({}))
  if(!upload.ok||!item?.id)throw new Error('onedrive_upload_failed')
  const share=await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(item.id)}/createLink`,{method:'POST',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({type:'view',scope:'organization'})})
  const link=await share.json().catch(()=>({}))
  if(!share.ok)throw new Error('onedrive_share_failed')
  return {external_id:item.id,shared_url:link?.link?.webUrl||item?.webUrl||null}
}

async function preparedExport(admin:any,user:any,body:any,method:string){
  const repEmail=String(body.rep_email||'').trim().toLowerCase()||null
  if(repEmail&&!emailPattern.test(repEmail))throw new Error('invalid_rep_email')
  const today=new Date().toISOString().slice(0,10),fromValue=String(body.from||today.slice(0,8)+'01'),toValue=String(body.to||today)
  const from=pacificMidnight(fromValue),toStart=pacificMidnight(addCalendarDays(toValue,1))
  if(!from||!toStart||toStart<=from)throw new Error('invalid_date_range')
  const lastIncluded=new Date(toStart.getTime()-1),contextFrom=pacificMidnight(startOfWeekPacific(from)!),contextTo=pacificMidnight(addCalendarDays(startOfWeekPacific(lastIncluded)!,7))
  const contextRows=await loadSales(admin,{repEmail,from:contextFrom,to:contextTo})
  const rule=await activeRule(admin),annotated=annotateEarnedPay(contextRows,rule)
  const rows=annotated.filter((row:any)=>{const created=new Date(row.created_at);return created>=from&&created<toStart})
  const csv=buildAccountingCsv(rows),bytes=new TextEncoder().encode(csv)
  if(bytes.byteLength>10485760)throw new Error('accounting_file_too_large')
  const exportId=crypto.randomUUID(),fileName=`mccoy-accounting-${safeFilePart(repEmail||'all-reps')}-${fromValue}-to-${toValue}.csv`
  const storagePath=`${new Date().toISOString().slice(0,7).replace('-','/')}/${exportId}/${fileName}`
  const {error:uploadError}=await admin.storage.from('accounting-records').upload(storagePath,bytes,{contentType:'text/csv',upsert:false})
  if(uploadError)throw new Error('private_accounting_storage_failed')
  const hash=await sha256(bytes)
  const {error:logError}=await admin.from('accounting_file_deliveries').insert({id:exportId,created_by:user.id,created_by_email:user.email,delivery_method:method,recipient_email:method==='email'?String(body.recipient_email||'').trim().toLowerCase()||null:null,rep_email:repEmail,period_start:from.toISOString(),period_end:toStart.toISOString(),file_name:fileName,storage_path:storagePath,content_sha256:hash,record_count:rows.length,status:'prepared',metadata:{timezone:'America/Los_Angeles',format:'csv',contains_customer_pii:true}})
  if(logError){await admin.storage.from('accounting-records').remove([storagePath]);throw logError}
  return {exportId,fileName,storagePath,bytes,csv,rows,fromValue,toValue,period:`${fromValue} to ${toValue}`}
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user},error:userError}=await admin.auth.getUser(jwt)
    if(userError||!user?.email)return json({error:'unauthorized'},401)
    const email=user.email.toLowerCase()
    const [{data:access},{data:accounting}]=await Promise.all([
      admin.from('app_user_access').select('role,active,display_name').eq('email',email).maybeSingle(),
      admin.from('accounting_access').select('active').eq('email',email).maybeSingle()
    ])
    if(!access?.active)return json({error:'forbidden'},403)
    const canAudit=access.role==='admin'||!!accounting?.active
    const body=await req.json().catch(()=>({})),action=String(body.action||'customer_list')

    if(action==='customer_list'){
      const adminScope=access.role==='admin'
      const records=await loadSales(admin,{repEmail:adminScope?null:email,limit:50000})
      const rule=await activeRule(admin)
      const rows=annotateEarnedPay(records,rule)
        .filter((row:any)=>row.sale_status!=='not_a_sale'&&row.required_metrics_complete===true)
        .sort((left:any,right:any)=>String(right.created_at).localeCompare(String(left.created_at)))
      const customerRows=rows.map((row:any)=>({id:row.id,order_date:row.order_date,install_date:row.install_date,rep_name:row.rep_name,rep_email:row.rep_email,customer_first_name:row.customer_first_name,customer_last_name:row.customer_last_name,customer_phone:row.customer_phone,customer_email:row.customer_email,service_address:row.service_address,isp:row.isp,internet_product:row.internet_product,internet_speed_mbps:row.internet_speed_mbps,voip_home_phone_lines:row.voip_home_phone_lines,directv:row.directv,directv_service:row.directv_service,vivint:row.vivint,vivint_service:row.vivint_service,mobile_phone_lines:row.mobile_phone_lines,provider_order_number:row.provider_order_number,provider_account_number:row.provider_account_number,verification_status:row.verification_status,verification_reason:row.verification_reason,sale_status:row.sale_status,current_earned_pay:row.current_earned_pay,cancellation_reduction:row.cancellation_reduction,pay_status:row.pay_status}))
      await admin.from('customer_list_access_log').insert({user_id:user.id,user_email:email,record_count:customerRows.length,filters:{scope:adminScope?'all_valid_sales':'own_valid_sales',required_metrics_complete:true,not_a_sale_excluded:true}})
      return json({ok:true,display_name:access.display_name||email,admin_scope:adminScope,records:customerRows,summary:{orders:customerRows.length,current_earned_pay:customerRows.reduce((sum:number,row:any)=>sum+Number(row.current_earned_pay||0),0),cancellation_reductions:customerRows.reduce((sum:number,row:any)=>sum+Number(row.cancellation_reduction||0),0)}})
    }

    if(!canAudit)return json({error:'admin_or_accounting_required'},403)
    if(action==='status'){
      const {data:reps,error}=await admin.from('app_user_access').select('email,display_name,role,active').eq('active',true).in('role',['rep','manager','trainer']).order('display_name')
      if(error)throw error
      return json({ok:true,can_audit:true,delivery:config(),reps:reps||[]})
    }

    if(!['download','send_email','send_onedrive'].includes(action))return json({error:'unsupported_action'},400)
    const method=action==='send_email'?'email':action==='send_onedrive'?'onedrive':'download'
    if(method==='email'){
      const recipient=String(body.recipient_email||'').trim().toLowerCase()
      if(!emailPattern.test(recipient))return json({error:'valid_recipient_email_required'},400)
    }
    let prepared:any=null
    try{
      prepared=await preparedExport(admin,user,body,method)
      if(method==='download'){
        return new Response(prepared.csv,{headers:{...corsHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${prepared.fileName}"`,'Cache-Control':'no-store','X-McCoy-Export-Id':prepared.exportId}})
      }
      const delivered=method==='email'
        ?await sendEmail(prepared.bytes,prepared.fileName,String(body.recipient_email).trim().toLowerCase(),prepared.rows.length,prepared.period,prepared.exportId)
        :await uploadOneDrive(prepared.bytes,prepared.fileName)
      await admin.from('accounting_file_deliveries').update({status:method==='email'?'sent':'uploaded',external_id:delivered.external_id||null,shared_url:delivered.shared_url||null}).eq('id',prepared.exportId)
      return json({ok:true,export_id:prepared.exportId,file_name:prepared.fileName,record_count:prepared.rows.length,delivery_method:method,shared_url:delivered.shared_url||null})
    }catch(error){
      const code=String((error as Error)?.message||error).slice(0,140)
      if(prepared?.exportId)await admin.from('accounting_file_deliveries').update({status:'failed',error_code:code}).eq('id',prepared.exportId)
      const configurationError=code==='email_not_configured'||code==='onedrive_not_configured'
      return json({error:code},configurationError?503:400)
    }
  }catch(error){console.error('accounting-records',error);return json({error:'accounting_records_failed'},500)}
})
