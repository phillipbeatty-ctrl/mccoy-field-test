import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const json=(body:any,status=200)=>Response.json(body,{status,headers:{...corsHeaders,'Cache-Control':'no-store'}})
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function outsideSystem(snapshot:any){
  return snapshot?.sale_origin==='outside_system'||snapshot?.sale_context==='out_of_area_phone'
}

function approvalStatus(snapshot:any){
  const status=String(snapshot?.admin_approval?.status||'').toLowerCase()
  if(['pending','approved','rejected'].includes(status))return status
  return outsideSystem(snapshot)?'pending':'not_required'
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user},error:userError}=await admin.auth.getUser(jwt)
    if(userError||!user?.email)return json({error:'unauthorized'},401)
    const email=user.email.trim().toLowerCase()
    const {data:access,error:accessError}=await admin.from('app_user_access').select('active,role').eq('email',email).maybeSingle()
    if(accessError)throw accessError
    if(!access?.active||access.role!=='admin')return json({error:'admin_only'},403)

    const body=await req.json().catch(()=>({}))
    const action=String(body.action||'list')
    if(action==='list'){
      const pending:any[]=[]
      for(let page=0;page<10;page++){
        const {data,error}=await admin.from('sales_records')
          .select('id,created_at,rep_name,rep_email,isp,service_address,provider_order_number,provider_account_number,verification_status,verification_reason,competition_eligible,sale_status,compensation_snapshot')
          .order('created_at',{ascending:false})
          .range(page*500,page*500+499)
        if(error)throw error
        const rows=data||[]
        pending.push(...rows.filter((sale:any)=>outsideSystem(sale.compensation_snapshot)&&approvalStatus(sale.compensation_snapshot)==='pending'))
        if(rows.length<500)break
      }
      return json({ok:true,pending,pending_count:pending.length})
    }

    if(action==='review'){
      const saleId=String(body.sale_id||'').trim(),decision=String(body.decision||'').trim().toLowerCase(),notes=String(body.notes||'').trim().slice(0,1000)||null
      if(!uuid.test(saleId))return json({error:'valid_sale_id_required'},400)
      if(!['approved','rejected'].includes(decision))return json({error:'approved_or_rejected_required'},400)
      const {data:sale,error:saleError}=await admin.from('sales_records').select('id,verification_status,sale_status,compensation_snapshot').eq('id',saleId).maybeSingle()
      if(saleError)throw saleError
      if(!sale)return json({error:'sale_not_found'},404)
      const previous=sale.compensation_snapshot&&typeof sale.compensation_snapshot==='object'?sale.compensation_snapshot:{}
      if(!outsideSystem(previous))return json({error:'outside_system_sale_required'},400)
      const reviewedAt=new Date().toISOString()
      const snapshot={...previous,sale_origin:'outside_system',admin_approval:{required:true,status:decision,reviewed_by:email,reviewed_at:reviewedAt,notes}}
      const competitionEligible=decision==='approved'&&sale.verification_status==='verified_processed'&&sale.sale_status!=='cancelled'
      const {error:updateError}=await admin.from('sales_records').update({compensation_snapshot:snapshot,competition_eligible:competitionEligible}).eq('id',saleId)
      if(updateError)throw updateError
      return json({ok:true,sale_id:saleId,decision,reviewed_at:reviewedAt,competition_eligible:competitionEligible})
    }

    return json({error:'unknown_action'},400)
  }catch(error){
    console.error('sale-approvals',error)
    return json({error:'sale_approval_failed'},500)
  }
})
