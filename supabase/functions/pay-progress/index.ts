import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { normalizePayLevel, payLevelLabel, weeklyProductionTier } from '../_shared/compensation-calculator.mjs'

function startOfWeekPacific(d=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(d)
  const get=(t:string)=>parts.find(p=>p.type===t)?.value||''
  const y=Number(get('year')),m=Number(get('month')),day=Number(get('day')),wd=get('weekday')
  const map:any={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6},delta=(map[wd]+6)%7
  const noonUTC=new Date(Date.UTC(y,m-1,day,12,0,0));noonUTC.setUTCDate(noonUTC.getUTCDate()-delta)
  const localParts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(noonUTC)
  const yy=Number(localParts.find(p=>p.type==='year')?.value),mm=Number(localParts.find(p=>p.type==='month')?.value),dd=Number(localParts.find(p=>p.type==='day')?.value)
  return new Date(Date.UTC(yy,mm-1,dd,7,0,0))
}

function adminApprovalAllows(snapshot:any){
  const outside=snapshot?.sale_origin==='outside_system'||snapshot?.sale_context==='out_of_area_phone'
  return !outside||String(snapshot?.admin_approval?.status||'').toLowerCase()==='approved'
}

async function weeklyEligibleSales(admin:any,userId:string,weekStart:Date){
  const sales:any[]=[]
  for(let page=0;page<25;page++){
    const {data,error}=await admin.from('sales_records').select('id,isp,internet_product,compensation_snapshot')
      .eq('rep_user_id',userId)
      .eq('verification_status','verified_processed')
      .eq('competition_eligible',true)
      .gte('created_at',weekStart.toISOString())
      .neq('sale_status','cancelled')
      .range(page*1000,page*1000+999)
    if(error)throw error
    const rows=data||[]
    sales.push(...rows.filter((sale:any)=>adminApprovalAllows(sale.compensation_snapshot)))
    if(rows.length<1000)return sales
  }
  throw new Error('weekly_eligible_sales_too_large')
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
    if(!jwt)return Response.json({error:'unauthorized'},{status:401,headers:corsHeaders})
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user},error:uerr}=await admin.auth.getUser(jwt)
    if(uerr||!user?.email)return Response.json({error:'unauthorized'},{status:401,headers:corsHeaders})
    const {data:access}=await admin.from('app_user_access').select('active,display_name,sales_classification').eq('email',user.email.toLowerCase()).maybeSingle()
    if(!access?.active)return Response.json({error:'forbidden'},{status:403,headers:corsHeaders})
    const {data:cr}=await admin.from('compensation_rules').select('rule').eq('active',true).limit(1).maybeSingle()
    const rule:any=cr?.rule||{}
    const weekStart=startOfWeekPacific()
    const sales=await weeklyEligibleSales(admin,user.id,weekStart)
    const salesCount=sales.length
    const tierResult=weeklyProductionTier(rule,salesCount)
    const currentIncrease=Number(tierResult.current?.increase_per_sale||0)
    const nextTier=tierResult.next
    const payLevel=normalizePayLevel(access.sales_classification)
    let baseAndMobileCommission=0,unpricedSales=0
    for(const sale of sales){
      const snapshot=sale.compensation_snapshot||{}
      const base=Number(snapshot.base_commission)
      const mobile=Number(snapshot.att_mobile_originating_commission||0)
      if(snapshot.base_commission!=null&&Number.isFinite(base))baseAndMobileCommission+=base
      else if(sale.isp==='Quantum'||sale.isp==='Brightspeed'||(sale.isp==='AT&T'&&['Fiber','Internet Air'].includes(String(sale.internet_product||''))))unpricedSales++
      if(Number.isFinite(mobile))baseAndMobileCommission+=mobile
    }
    const productionIncreaseTotal=currentIncrease*salesCount
    return Response.json({
      ok:true,
      display_name:access.display_name||user.email,
      pay_level:payLevel,
      pay_level_label:payLevelLabel(payLevel),
      pay_level_assigned:!!payLevel,
      week_start:weekStart.toISOString(),
      weekly_sales:salesCount,
      current_increase_per_sale:currentIncrease,
      next_threshold:nextTier?.min_sales??null,
      next_increase_per_sale:nextTier?.increase_per_sale??null,
      sales_needed_for_next:nextTier?Math.max(0,nextTier.min_sales-salesCount):0,
      tiers:tierResult.tiers,
      base_and_mobile_commission:baseAndMobileCommission,
      weekly_production_increase_total:productionIncreaseTotal,
      estimated_weekly_commission:baseAndMobileCommission+productionIncreaseTotal,
      unpriced_sales:unpricedSales,
      eligibility_policy:'isp_verified_and_admin_approved_when_required',
      estimate_excludes:['manager_overrides','trainer_overrides','driver_compensation','mobile_processor_compensation','directv','vivint','chargebacks']
    },{headers:{...corsHeaders,'Cache-Control':'no-store'}})
  }catch(error){console.error('pay-progress',error);return Response.json({error:'pay_progress_failed'},{status:500,headers:corsHeaders})}
})
