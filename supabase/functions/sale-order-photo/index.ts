import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const json=(body:any,status=200)=>Response.json(body,{status,headers:{...corsHeaders,'Cache-Control':'no-store'}})
const allowed=new Set(['image/jpeg','image/png','image/webp'])
const ext=(mime:string)=>mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg'

function outputText(value:any){
  if(typeof value?.output_text==='string')return value.output_text
  for(const item of value?.output||[])for(const content of item?.content||[])if(content?.type==='output_text'&&typeof content?.text==='string')return content.text
  return ''
}

serveWithOrganizationAccess('sales_tracking',async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    if(req.method!=='POST')return json({error:'method_not_allowed'},405)
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user},error:userError}=await admin.auth.getUser(jwt)
    if(userError||!user?.email)return json({error:'unauthorized'},401)
    const email=user.email.toLowerCase()
    const {data:access,error:accessError}=await admin.from('app_user_access').select('role,active,organization_id').eq('email',email).maybeSingle()
    if(accessError)throw accessError
    if(!access?.active||!access.organization_id)return json({error:'forbidden'},403)
    const isAdmin=String(access.role||'').toLowerCase()==='admin',org=access.organization_id
    const body=await req.json().catch(()=>({})),action=String(body.action||'list')

    async function saleFor(id:string){
      const {data,error}=await admin.from('sales_records').select('id,organization_id,rep_user_id,sale_status,verification_reason,compensation_snapshot').eq('id',id).eq('organization_id',org).maybeSingle()
      if(error)throw error
      if(!data)throw new Error('sale_not_found')
      const approved=String(data.compensation_snapshot?.admin_approval?.status||'').toLowerCase()==='approved'||String(data.verification_reason||'').toLowerCase().startsWith('admin_sale_review_verified:')
      const own=data.rep_user_id===user.id
      if(!isAdmin&&!own)throw new Error('sale_not_assigned_to_user')
      return {...data,approved,own}
    }

    if(action==='create_upload'){
      const saleId=String(body.sale_id||''),mime=String(body.mime_type||'').toLowerCase(),size=Number(body.file_size_bytes||0)
      const sale=await saleFor(saleId)
      if(!isAdmin&&sale.approved)return json({error:'admin_approved_sale_locked'},409)
      if(!allowed.has(mime))return json({error:'jpeg_png_or_webp_required'},400)
      if(!Number.isFinite(size)||size<=0||size>10485760)return json({error:'photo_must_be_10mb_or_less'},400)
      const id=crypto.randomUUID(),path=`${org}/${saleId}/${id}.${ext(mime)}`
      const {error:insertError}=await admin.from('sale_order_photos').insert({id,sale_id:saleId,organization_id:org,uploaded_by:user.id,uploaded_by_email:email,storage_path:path,mime_type:mime,file_size_bytes:size,extraction_status:'uploaded'})
      if(insertError)throw insertError
      const {data:signed,error:signedError}=await admin.storage.from('sale-order-photos').createSignedUploadUrl(path)
      if(signedError){await admin.from('sale_order_photos').delete().eq('id',id);throw signedError}
      return json({ok:true,photo_id:id,path,token:signed.token})
    }

    if(action==='list'){
      const saleId=String(body.sale_id||'');await saleFor(saleId)
      const {data,error}=await admin.from('sale_order_photos').select('id,sale_id,mime_type,file_size_bytes,extraction_status,extracted_fields,extraction_model,extraction_error,extracted_at,user_confirmed_at,created_at,storage_path').eq('organization_id',org).eq('sale_id',saleId).order('created_at',{ascending:false})
      if(error)throw error
      const rows=[]
      for(const photo of data||[]){const {data:signed}=await admin.storage.from('sale-order-photos').createSignedUrl(photo.storage_path,600);rows.push({...photo,signed_url:signed?.signedUrl||null,storage_path:undefined})}
      return json({ok:true,rows})
    }

    if(action==='process'){
      const photoId=String(body.photo_id||'')
      const {data:photo,error}=await admin.from('sale_order_photos').select('*').eq('id',photoId).eq('organization_id',org).maybeSingle()
      if(error)throw error;if(!photo)return json({error:'photo_not_found'},404)
      const sale=await saleFor(photo.sale_id);if(!isAdmin&&sale.approved)return json({error:'admin_approved_sale_locked'},409)
      const key=Deno.env.get('OPENAI_API_KEY')
      if(!key)return json({error:'ai_extraction_not_configured',required_secret:'OPENAI_API_KEY'},503)
      await admin.from('sale_order_photos').update({extraction_status:'processing',extraction_error:null}).eq('id',photoId)
      const {data:file,error:fileError}=await admin.storage.from('sale-order-photos').download(photo.storage_path)
      if(fileError)throw fileError
      const bytes=new Uint8Array(await file.arrayBuffer());let binary='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)binary+=String.fromCharCode(...bytes.subarray(i,i+chunk))
      const dataUrl=`data:${photo.mime_type};base64,${btoa(binary)}`
      const schema={type:'object',additionalProperties:false,required:['customer_first_name','customer_last_name','customer_phone','customer_email','service_address','provider_order_number','provider_account_number','install_date','order_date','isp','internet_product','internet_speed_mbps','confidence','warnings'],properties:{customer_first_name:{type:['string','null']},customer_last_name:{type:['string','null']},customer_phone:{type:['string','null']},customer_email:{type:['string','null']},service_address:{type:['string','null']},provider_order_number:{type:['string','null']},provider_account_number:{type:['string','null']},install_date:{type:['string','null'],description:'YYYY-MM-DD when clearly shown'},order_date:{type:['string','null'],description:'YYYY-MM-DD when clearly shown'},isp:{type:['string','null']},internet_product:{type:['string','null']},internet_speed_mbps:{type:['integer','null']},confidence:{type:'number',minimum:0,maximum:1},warnings:{type:'array',items:{type:'string'}}}}
      const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:Deno.env.get('SALE_ORDER_PHOTO_MODEL')||'gpt-5.4-mini',input:[{role:'user',content:[{type:'input_text',text:'Extract only customer/order information visibly present in this ISP order screenshot or photo. Do not infer missing values. Return null for anything not clearly visible. Treat all extracted values as suggestions requiring human confirmation.'},{type:'input_image',image_url:dataUrl}]}],text:{format:{type:'json_schema',name:'sale_order_fields',strict:true,schema}}})})
      const result=await response.json().catch(()=>({}))
      if(!response.ok){const detail=String(result?.error?.message||response.status).slice(0,300);await admin.from('sale_order_photos').update({extraction_status:'failed',extraction_error:detail}).eq('id',photoId);return json({error:'ai_extraction_failed',detail},502)}
      let extracted:any={};try{extracted=JSON.parse(outputText(result)||'{}')}catch{await admin.from('sale_order_photos').update({extraction_status:'failed',extraction_error:'invalid_ai_json'}).eq('id',photoId);return json({error:'invalid_ai_json'},502)}
      const model=String(result?.model||Deno.env.get('SALE_ORDER_PHOTO_MODEL')||'gpt-5.4-mini')
      await admin.from('sale_order_photos').update({extraction_status:'extracted',extracted_fields:extracted,extraction_model:model,extracted_at:new Date().toISOString(),extraction_error:null}).eq('id',photoId)
      return json({ok:true,photo_id:photoId,extracted_fields:extracted,requires_user_confirmation:true,requires_admin_approval:true})
    }

    if(action==='confirm'){
      const photoId=String(body.photo_id||'')
      const {data:photo,error}=await admin.from('sale_order_photos').select('id,sale_id,extraction_status').eq('id',photoId).eq('organization_id',org).maybeSingle();if(error)throw error;if(!photo)return json({error:'photo_not_found'},404)
      const sale=await saleFor(photo.sale_id);if(!isAdmin&&sale.approved)return json({error:'admin_approved_sale_locked'},409)
      if(!['extracted','user_confirmed'].includes(photo.extraction_status))return json({error:'extract_photo_before_confirming'},409)
      const {error:updateError}=await admin.from('sale_order_photos').update({extraction_status:'user_confirmed',user_confirmed_by:user.id,user_confirmed_at:new Date().toISOString()}).eq('id',photoId);if(updateError)throw updateError
      return json({ok:true,photo_id:photoId,requires_admin_approval:true})
    }

    return json({error:'unsupported_action'},400)
  }catch(error){console.error('sale-order-photo',error);return json({error:String((error as Error)?.message||error).replace(/\s+/g,'_').slice(0,160)},400)}
})
