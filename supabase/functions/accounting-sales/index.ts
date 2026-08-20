import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
function esc(v:any){const s=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);return '"'+s.replaceAll('"','""')+'"'}
function auditValue(row:any,column:string){
 const snapshot=row.compensation_snapshot||{}
 if(column==='order_date')return row.created_at
 if(column==='commission_pay_level')return snapshot.pay_level||snapshot.classification||null
 if(column==='base_commission')return snapshot.base_commission
 if(column==='att_mobile_originating_commission')return snapshot.att_mobile_originating_commission
 if(column==='weekly_production_schedule')return snapshot.weekly_production_pay_increase
 if(column==='commission_rule_source')return snapshot.source
 return row[column]
}
Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});try{
 const auth=req.headers.get('Authorization')||'',jwt=auth.replace(/^Bearer\s+/,'');if(!jwt)return Response.json({error:'unauthorized'},{status:401,headers:corsHeaders});
 const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:uerr}=await admin.auth.getUser(jwt);if(uerr||!user?.email)return Response.json({error:'unauthorized'},{status:401,headers:corsHeaders});
 const email=user.email.toLowerCase();const {data:access}=await admin.from('app_user_access').select('role,active').eq('email',email).maybeSingle();const {data:acct}=await admin.from('accounting_access').select('active').eq('email',email).maybeSingle();if(!(access?.active&&access.role==='admin')&&!acct?.active)return Response.json({error:'forbidden'},{status:403,headers:corsHeaders});
 const u=new URL(req.url),from=u.searchParams.get('from'),to=u.searchParams.get('to'),format=u.searchParams.get('format')||'json';let q=admin.from('sales_records').select('*').order('created_at',{ascending:false});if(from)q=q.gte('created_at',from);if(to)q=q.lte('created_at',to);const {data,error}=await q;if(error)throw error;const rows=data||[];
 if(format==='csv'){const cols=['id','order_date','install_date','rep_name','rep_email','commission_pay_level','base_commission','att_mobile_originating_commission','weekly_production_schedule','commission_rule_source','lead_label','customer_first_name','customer_last_name','customer_phone','customer_email','service_address','isp','internet_product','internet_speed_mbps','directv','directv_service','mobile_phone_lines','mobile_device_count','mobile_device_protection','att_mobile_lines','att_device_count','att_device_protection','vivint','vivint_service','sale_status','notes','compensation_snapshot'];const csv=[cols.join(','),...rows.map((r:any)=>cols.map(c=>esc(auditValue(r,c))).join(','))].join('\n');return new Response(csv,{headers:{...corsHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="mccoy-sales-ledger.csv"','Cache-Control':'no-store'}})}
 return Response.json({ok:true,count:rows.length,records:rows},{headers:{...corsHeaders,'Cache-Control':'no-store'}});
}catch(e){console.error(e);return Response.json({error:'accounting_export_failed'},{status:500,headers:corsHeaders});}});
