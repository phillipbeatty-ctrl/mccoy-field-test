import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})
const norm=(value:any)=>String(value??'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'')
const provider=(value:any)=>{
  const normalized=norm(value)
  if(normalized.includes('brightspeed'))return'Brightspeed'
  if(normalized.includes('quantum'))return'Quantum'
  if(normalized==='att'||normalized.includes('atandt'))return'AT&T'
  if(normalized.includes('tmobile')||normalized.includes('tfiber'))return'T-Mobile / T-Fiber'
  if(normalized.includes('kinetic')||normalized.includes('windstream'))return'Kinetic'
  if(normalized.includes('fidium'))return'Fidium'
  if(normalized.includes('ascend'))return'Ascend Fiber'
  if(normalized.includes('lightcurve'))return'Lightcurve'
  if(normalized.includes('ripple'))return'Ripple Fiber'
  if(normalized.includes('starlink'))return'Starlink'
  if(normalized.includes('directv'))return'DIRECTV'
  if(normalized.includes('vivint')||normalized.includes('vivant'))return'Vivint'
  return String(value??'').trim()||null
}

function parseCsv(text:string){
  const output:string[][]=[]
  let row:string[]=[],cell='',quoted=false
  for(let index=0;index<text.length;index++){
    const current=text[index],next=text[index+1]
    if(current==='"'){
      if(quoted&&next==='"'){cell+='"';index++}else quoted=!quoted
    }else if(current===','&&!quoted){row.push(cell);cell=''}
    else if((current==='\n'||current==='\r')&&!quoted){
      if(current==='\r'&&next==='\n')index++
      row.push(cell);cell=''
      if(row.some(value=>value.trim()))output.push(row)
      row=[]
    }else cell+=current
  }
  row.push(cell)
  if(row.some(value=>value.trim()))output.push(row)
  return output
}

const pick=(object:any,keys:string[])=>{
  for(const expected of keys){
    const key=Object.keys(object).find(candidate=>norm(candidate)===norm(expected))
    if(key&&String(object[key]??'').trim())return String(object[key]).trim()
  }
  return null
}

function outsideSystem(sale:any){
  const snapshot=sale?.compensation_snapshot||{}
  return snapshot.sale_origin==='outside_system'||snapshot.sale_context==='out_of_area_phone'
}

function approvalAllowsEligibility(sale:any){
  if(!outsideSystem(sale))return true
  return String(sale?.compensation_snapshot?.admin_approval?.status||'').toLowerCase()==='approved'
}

async function reconcile(admin:any,sale:any){
  const selectedProvider=provider(sale.isp),order=norm(sale.provider_order_number),account=norm(sale.provider_account_number)
  if(!order&&!account)return{status:'low_potential',reason:'missing_order_or_account_number',row:null}
  const {data:rows,error}=await admin.from('provider_sales_rows').select('*').eq('provider',selectedProvider).order('created_at',{ascending:false}).limit(25)
  if(error)throw error
  const matches=(rows||[]).filter((row:any)=>(order&&norm(row.order_number)===order)||(account&&norm(row.account_number)===account))
  if(!matches.length)return{status:'low_potential',reason:'not_yet_in_dealer_file',row:null}
  const {data:links}=await admin.from('provider_seller_links').select('seller_identifier').eq('rep_user_id',sale.rep_user_id).eq('provider',selectedProvider).eq('active',true)
  const identifiers=new Set((links||[]).map((link:any)=>norm(link.seller_identifier)).filter(Boolean))
  if(!identifiers.size)return{status:'pending_verification',reason:'seller_account_not_linked',row:matches[0]}
  const matched=matches.find((row:any)=>identifiers.has(norm(row.seller_identifier))||identifiers.has(norm(row.seller_email))||identifiers.has(norm(row.seller_name)))
  if(matched)return{status:'verified_processed',reason:'dealer_file_and_seller_match',row:matched}
  return{status:'mismatch',reason:'order_found_but_seller_does_not_match_linked_mccoy_user',row:matches[0]}
}

async function apply(admin:any,sale:any){
  const result=await reconcile(admin,sale)
  const eligible=result.status==='verified_processed'&&approvalAllowsEligibility(sale)&&sale.sale_status!=='cancelled'
  const patch:any={
    verification_status:result.status,
    verification_reason:result.reason,
    competition_eligible:eligible,
    provider_sale_row_id:result.row?.id||null,
    verified_at:result.status==='verified_processed'?new Date().toISOString():null,
    low_potential_since:result.status==='low_potential'?(sale.low_potential_since||new Date().toISOString()):null
  }
  const {error}=await admin.from('sales_records').update(patch).eq('id',sale.id)
  if(error)throw error
  return result
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user}}=await admin.auth.getUser(jwt)
    if(!user?.email)return json({error:'unauthorized'},401)
    const {data:access}=await admin.from('app_user_access').select('role,active').eq('email',user.email.toLowerCase()).maybeSingle()
    if(!access?.active)return json({error:'forbidden'},403)
    const body=await req.json().catch(()=>({})),action=String(body.action||'overview')

    if(action==='upload_csv'){
      if(access.role!=='admin')return json({error:'admin_only'},403)
      const text=String(body.csv_text||'')
      if(!text.trim())return json({error:'csv_required'},400)
      if(text.length>12000000)return json({error:'csv_too_large'},413)
      const rows=parseCsv(text)
      if(rows.length<2)return json({error:'csv_has_no_data'},400)
      const headers=rows[0].map(value=>value.replace(/^\uFEFF/,''))
      const {data:importRow,error:importError}=await admin.from('provider_sales_imports').insert({imported_by:user.id,imported_by_email:user.email,source_filename:String(body.filename||'dealer-sales.csv'),source_provider:body.provider?provider(body.provider):null,row_count:rows.length-1}).select('id').single()
      if(importError)throw importError
      let mapped=0
      for(let index=1;index<rows.length;index+=250){
        const chunk=rows.slice(index,index+250).map(values=>{
          const raw:any={};headers.forEach((header,column)=>raw[header]=values[column]??'')
          const selectedProvider=provider(pick(raw,['provider','carrier','isp','brand','product provider'])||body.provider)
          const order=pick(raw,['order number','order #','order id','order','confirmation number','confirmation #'])
          const account=pick(raw,['account number','account #','account id','customer account','ban'])
          const seller=pick(raw,['seller id','agent id','rep id','sales rep id','employee id','salesperson id'])
          const sellerName=pick(raw,['seller name','agent name','rep name','sales rep','salesperson','agent'])
          const sellerEmail=pick(raw,['seller email','agent email','rep email','sales rep email'])
          if(order||account)mapped++
          return {import_id:importRow.id,provider:selectedProvider,order_number:order,account_number:account,seller_identifier:seller||sellerEmail||sellerName,seller_name:sellerName,seller_email:sellerEmail,customer_name:pick(raw,['customer name','subscriber name','name']),service_address:pick(raw,['service address','address','install address']),sale_date:pick(raw,['sale date','order date','created date','submitted date','date']),provider_status:pick(raw,['status','order status','sale status']),raw_payload:raw}
        })
        const {error}=await admin.from('provider_sales_rows').insert(chunk)
        if(error)throw error
      }
      await admin.from('provider_sales_imports').update({mapped_row_count:mapped,notes:`${mapped} rows contained an order or account identifier.`}).eq('id',importRow.id)
      const {data:sales}=await admin.from('sales_records').select('*').in('verification_status',['pending_verification','low_potential','mismatch']).order('created_at',{ascending:false}).limit(5000)
      let verified=0
      for(const sale of sales||[]){const result=await apply(admin,sale);if(result.status==='verified_processed')verified++}
      return json({ok:true,import_id:importRow.id,rows:rows.length-1,mapped,verified_after_import:verified,headers})
    }

    if(action==='link_seller'){
      if(access.role!=='admin')return json({error:'admin_only'},403)
      const repEmail=String(body.rep_email||'').trim().toLowerCase(),selectedProvider=provider(body.provider),sellerIdentifier=String(body.seller_identifier||'').trim()
      if(!repEmail||!selectedProvider||!sellerIdentifier)return json({error:'rep_provider_seller_required'},400)
      const {data:authUsers}=await admin.auth.admin.listUsers({page:1,perPage:1000})
      const rep=authUsers?.users?.find((candidate:any)=>String(candidate.email||'').toLowerCase()===repEmail)
      if(!rep)return json({error:'rep_not_found'},404)
      const {error}=await admin.from('provider_seller_links').upsert({rep_user_id:rep.id,rep_email:repEmail,provider:selectedProvider,seller_identifier:sellerIdentifier,seller_name:body.seller_name||null,active:true},{onConflict:'rep_user_id,provider,seller_identifier'})
      if(error)throw error
      return json({ok:true})
    }

    if(action==='reconcile_all'){
      if(access.role!=='admin')return json({error:'admin_only'},403)
      const {data:sales,error}=await admin.from('sales_records').select('*').order('created_at',{ascending:false}).limit(5000)
      if(error)throw error
      const counts:any={verified_processed:0,low_potential:0,pending_verification:0,mismatch:0}
      for(const sale of sales||[]){const result=await apply(admin,sale);counts[result.status]=(counts[result.status]||0)+1}
      return json({ok:true,counts,total:(sales||[]).length})
    }

    if(action==='overview'){
      if(access.role!=='admin')return json({error:'admin_only'},403)
      const {data:imports}=await admin.from('provider_sales_imports').select('id,source_filename,row_count,mapped_row_count,created_at').order('created_at',{ascending:false}).limit(10)
      const {data:sales}=await admin.from('sales_records').select('id,created_at,rep_name,rep_email,isp,service_address,provider_order_number,provider_account_number,verification_status,verification_reason,competition_eligible').order('created_at',{ascending:false}).limit(500)
      const counts:any={}
      for(const sale of sales||[])counts[sale.verification_status]=(counts[sale.verification_status]||0)+1
      return json({ok:true,counts,imports:imports||[],low_potential:(sales||[]).filter((sale:any)=>sale.verification_status==='low_potential').slice(0,100),recent_sales:(sales||[]).slice(0,50)})
    }

    return json({error:'unknown_action'},400)
  }catch(error){
    console.error('provider-reconcile',error)
    return json({error:'provider_reconcile_failed',detail:String((error as Error)?.message||error)},500)
  }
})
