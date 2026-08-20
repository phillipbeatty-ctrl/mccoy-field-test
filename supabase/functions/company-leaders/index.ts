import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

function zonedParts(d:Date){const f=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(d);const g=(t:string)=>f.find(p=>p.type===t)?.value||'';return {y:+g('year'),m:+g('month'),d:+g('day'),w:g('weekday')}}
function utcForPacificMidnight(y:number,m:number,d:number){const probe=new Date(Date.UTC(y,m-1,d,8));const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'shortOffset',hour:'2-digit'}).formatToParts(probe);const z=fmt.find(p=>p.type==='timeZoneName')?.value||'GMT-7';const mt=z.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);let off=0;if(mt){off=(+mt[2]*60+(+(mt[3]||0)))*(mt[1]==='-'?-1:1)}return new Date(Date.UTC(y,m-1,d,0,0)-off*60000)}
function starts(now=new Date()){const p=zonedParts(now),map:any={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};const day=utcForPacificMidnight(p.y,p.m,p.d);const wd=(map[p.w]+6)%7;const monday=new Date(Date.UTC(p.y,p.m-1,p.d-wd,12));const week=utcForPacificMidnight(monday.getUTCFullYear(),monday.getUTCMonth()+1,monday.getUTCDate());return {today:day,week,month:utcForPacificMidnight(p.y,p.m,1),year:utcForPacificMidnight(p.y,1,1)}}
function top(rows:any[],start:Date|null){const m=new Map<string,{name:string,count:number}>();for(const r of rows){if(start&&new Date(r.created_at)<start)continue;const k=r.rep_user_id||r.rep_name;const x=m.get(k)||{name:r.rep_name||'Rep',count:0};x.count++;m.set(k,x)}const a=[...m.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));return a.length?a[0]:null}

const rankingPeriods=['today','week','month','year'] as const
const rankingTieBreakers:any={today:['today','week','month','year'],week:['week','month','year','today'],month:['month','year','week','today'],year:['year','month','week','today']}
function adminApprovalAllows(snapshot:any){const outside=snapshot?.sale_origin==='outside_system'||snapshot?.sale_context==='out_of_area_phone';return !outside||String(snapshot?.admin_approval?.status||'').toLowerCase()==='approved'}
async function loadEligibleSales(admin:any){
  const sales:any[]=[]
  for(let page=0;page<100;page++){
    const {data,error}=await admin.from('sales_records').select('created_at,rep_user_id,rep_email,rep_name,att_mobile_lines,directv,vivint,compensation_snapshot')
      .eq('verification_status','verified_processed')
      .eq('competition_eligible',true)
      .neq('sale_status','cancelled')
      .order('created_at',{ascending:true})
      .range(page*1000,page*1000+999)
    if(error)throw error
    const batch=data||[]
    sales.push(...batch.filter((sale:any)=>adminApprovalAllows(sale.compensation_snapshot)))
    if(batch.length<1000)return sales
  }
  throw new Error('eligible_sales_history_too_large')
}
function buildRepRankings(accounts:any[],sales:any[],boundaries:any,currentEmail:string){
  const entries=new Map<string,any>()
  for(const account of accounts){
    const key=String(account.email||'').trim().toLowerCase()
    if(!key)continue
    entries.set(key,{key,rep_name:String(account.display_name||'').trim()||'Rep',today_sales:0,week_sales:0,month_sales:0,year_sales:0,month_mobile_lines:0,month_directv:0,month_vivint:0,ranks:{today:0,week:0,month:0,year:0},is_current_user:key===currentEmail})
  }
  for(const sale of sales){
    const key=String(sale.rep_email||'').trim().toLowerCase(),entry=entries.get(key)
    if(!entry)continue
    if(entry.rep_name==='Rep'&&sale.rep_name)entry.rep_name=String(sale.rep_name).trim()
    const created=new Date(sale.created_at)
    for(const period of rankingPeriods)if(created>=boundaries[period])entry[period+'_sales']++
    if(created>=boundaries.month){entry.month_mobile_lines+=Number(sale.att_mobile_lines||0);entry.month_directv+=sale.directv?1:0;entry.month_vivint+=sale.vivint?1:0}
  }
  const result=[...entries.values()]
  for(const period of rankingPeriods){
    const ordered=[...result].sort((a,b)=>{
      for(const comparison of rankingTieBreakers[period]){const difference=b[comparison+'_sales']-a[comparison+'_sales'];if(difference)return difference}
      return a.rep_name.localeCompare(b.rep_name,undefined,{sensitivity:'base'})||a.key.localeCompare(b.key)
    })
    ordered.forEach((entry,index)=>{entry.ranks[period]=index+1})
  }
  return result.sort((a,b)=>a.ranks.week-b.ranks.week).map(({key:_privateEmail,...safe})=>safe)
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  try{
    const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer /i,'')
    if(!jwt)return Response.json({error:'unauthorized'},{status:401,headers:corsHeaders})
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user},error:userError}=await admin.auth.getUser(jwt)
    if(userError||!user?.email)return Response.json({error:'unauthorized'},{status:401,headers:corsHeaders})
    const currentEmail=user.email.trim().toLowerCase()
    const {data:access,error:accessError}=await admin.from('app_user_access').select('active,role').eq('email',currentEmail).maybeSingle()
    if(accessError)throw accessError
    if(!access?.active)return Response.json({error:'forbidden'},{status:403,headers:corsHeaders})
    const [{data:accounts,error:accountError},sales]=await Promise.all([admin.from('app_user_access').select('email,display_name,role').eq('active',true).in('role',['rep','manager']),loadEligibleSales(admin)])
    if(accountError)throw accountError
    const boundaries=starts(),rankings=buildRepRankings(accounts||[],sales,boundaries,currentEmail)
    return Response.json({ok:true,leaders:{today:top(sales,boundaries.today),week:top(sales,boundaries.week),month:top(sales,boundaries.month),year:top(sales,boundaries.year),all_time:top(sales,null)},rankings,current_rep:rankings.find(entry=>entry.is_current_user)||null,period_starts:Object.fromEntries(rankingPeriods.map(period=>[period,boundaries[period].toISOString()])),timezone:'America/Los_Angeles',eligibility_policy:'isp_verified_and_admin_approved_when_required'},{headers:{...corsHeaders,'Cache-Control':'no-store'}})
  }catch(error){console.error('Company leader calculation failed',error);return Response.json({error:'leaders_failed'},{status:500,headers:corsHeaders})}
})
