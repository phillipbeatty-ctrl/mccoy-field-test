import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'
import { assignedAdminManagerEmail, isManagerPermissionRole, managerControlsLead, normalizeEmail } from '../_shared/manager-lead-assignment.mjs'
const json=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})
function statesForTeam(team:any){const normalized=String(team||'').trim().toLowerCase();if(normalized==='pacific northwest')return ['OR','WA'];if(normalized==='north carolina')return ['NC'];return []}
function distanceMeters(lat1:number,lng1:number,lat2:number,lng2:number){const r=Math.PI/180,dlat=(lat2-lat1)*r,dlng=(lng2-lng1)*r;const a=Math.sin(dlat/2)**2+Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dlng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))}
function validArea(area:any){return Number.isFinite(Number(area.center_latitude))&&Number.isFinite(Number(area.center_longitude))&&Number.isFinite(Number(area.radius_m))&&Number(area.radius_m)>0}
function inAssignedArea(lead:any,area:any){const lat=Number(lead.latitude),lng=Number(lead.longitude);if(lead.latitude==null||lead.longitude==null||!Number.isFinite(lat)||!Number.isFinite(lng))return false;return distanceMeters(lat,lng,Number(area.center_latitude),Number(area.center_longitude))<=Number(area.radius_m)}
serveWithOrganizationAccess('lead_management',async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});try{
 const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'');if(!jwt)return json({error:'unauthorized'},401)
 const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:{user}}=await admin.auth.getUser(jwt);if(!user?.email)return json({error:'unauthorized'},401)
 const {data:access}=await admin.from('app_user_access').select('role,active,team_name,assigned_manager_email,assigned_admin_email,display_name').eq('email',user.email.toLowerCase()).maybeSingle();if(!access?.active)return json({error:'inactive_account'},403)
 const isAdmin=access.role==='admin',isManager=isManagerPermissionRole(access.role)
 const body=await req.json().catch(()=>({})),action=String(body.action||'')
 const managerActions=['list_reps','assign_lead','assign_leads']
 const allFieldActions=['list_real_leads','duplicate_status','delete_lead','remove_duplicate_leads']
 if(allFieldActions.includes(action)){/* Every active field account may view, disposition, and clean up real leads. */}else if(managerActions.includes(action)){if(!isAdmin&&!isManager)return json({error:'manager_or_admin_only'},403)}else if(!isAdmin)return json({error:'admin_only'},403)
 let authUsersPromise:Promise<any[]>|null=null
 const getAuthUsers=async()=>{if(!authUsersPromise)authUsersPromise=admin.auth.admin.listUsers({page:1,perPage:1000}).then(({data,error}:any)=>{if(error)throw error;return data?.users||[]});return await authUsersPromise}
 let managerScopePromise:Promise<any>|null=null
 const getManagerScope=async()=>{
   if(!isManager)return null
   if(!managerScopePromise)managerScopePromise=(async()=>{
     const ownerEmail=normalizeEmail(access.assigned_manager_email)
     const [{data:reports,error:reportError},{data:owner,error:ownerError}]=await Promise.all([
       admin.from('app_user_access').select('email,display_name,role,team_name,assigned_manager_email').eq('active',true).eq('role','rep').eq('assigned_manager_email',user.email.toLowerCase()).order('display_name'),
       ownerEmail?admin.from('app_user_access').select('email,display_name,role,active').eq('email',ownerEmail).eq('role','admin').eq('active',true).maybeSingle():Promise.resolve({data:null,error:null})
     ])
     if(reportError)throw reportError;if(ownerError)throw ownerError
     const authUsers=reports?.length?await getAuthUsers():[]
     const managedReps=(reports||[]).map((rep:any)=>{const account=authUsers.find((candidate:any)=>String(candidate.email||'').toLowerCase()===String(rep.email||'').toLowerCase());return {...rep,user_id:account?.id||null}}).filter((rep:any)=>rep.user_id)
     const adminEmail=assignedAdminManagerEmail(access,owner)
     return {reports:managedReps,reportIds:managedReps.map((rep:any)=>String(rep.user_id)),adminEmail,adminAssigned:Boolean(adminEmail)}
   })()
   return await managerScopePromise
 }
 const getRepresentativeManager=async()=>{
   const managerEmail=String(access.assigned_manager_email||'').trim().toLowerCase();if(!managerEmail)return null
   const {data:manager,error:managerError}=await admin.from('app_user_access').select('email,role,active,assigned_manager_email,assigned_admin_email').eq('email',managerEmail).maybeSingle();if(managerError)throw managerError
   if(!isManagerPermissionRole(manager?.role))return null
   const ownerEmail=normalizeEmail(manager.assigned_manager_email);if(!manager.active||!ownerEmail)return {invalid:true}
   const [{data:owner,error:ownerError},{data:profile,error:profileError}]=await Promise.all([
     admin.from('app_user_access').select('email,role,active').eq('email',ownerEmail).eq('role','admin').eq('active',true).maybeSingle(),
     admin.from('users').select('id,active').eq('email',manager.email).maybeSingle()
   ])
   if(ownerError)throw ownerError;if(profileError)throw profileError
   const adminEmail=assignedAdminManagerEmail(manager,owner)
   return adminEmail&&profile?.active?{id:profile.id,email:manager.email,adminEmail}:{invalid:true}
 }
 const resolveRep=async(repEmail:string)=>{
   if(!repEmail)return null;const email=repEmail.trim().toLowerCase()
   const {data:ua,error}=await admin.from('app_user_access').select('email,active,display_name,role,assigned_manager_email,assigned_admin_email').eq('email',email).maybeSingle();if(error)throw error;if(!ua?.active)return null
   if(isManager&&(ua.role!=='rep'||String(ua.assigned_manager_email||'').toLowerCase()!==String(user.email||'').toLowerCase()))return {forbidden:true}
   const authUsers=await getAuthUsers(),account=authUsers.find((candidate:any)=>String(candidate.email||'').toLowerCase()===email)
   return account?.id?{id:account.id,email,display_name:ua.display_name||email,role:ua.role,assigned_manager_email:ua.assigned_manager_email||null,assigned_admin_email:ua.assigned_admin_email||null}:null
 }
 const managerMayAssign=async(ids:any[])=>{
   if(!isManager)return {ok:true}
   const scope=await getManagerScope();if(!scope.adminAssigned)return {ok:false,error:'administrator_assignment_required'}
   const unique=[...new Set(ids.map((id:any)=>String(id)))],rows:any[]=[]
   const {data:batches,error:batchError}=await admin.from('spotio_import_batches').select('id,created_at,status,raw_payload').eq('status','normalized').order('created_at',{ascending:false}).limit(100);if(batchError)throw batchError
   const normalized=batches||[],canonical=normalized.find((batch:any)=>String(batch?.raw_payload?.source_type||'')==='spotio_json'),batchIds=new Set([canonical?.id,...normalized.filter((batch:any)=>String(batch?.raw_payload?.source_type||'')==='csv').map((batch:any)=>batch.id)].filter(Boolean).map(String))
   for(let index=0;index<unique.length;index+=75){const {data,error}=await admin.from('leads').select('id,assigned_rep_id,assigned_manager_id,assigned_admin_email,state,latitude,longitude,source_system,import_batch_id').in('id',unique.slice(index,index+75)).is('deleted_at',null);if(error)throw error;rows.push(...(data||[]))}
   if(rows.length!==unique.length)return {ok:false,error:'lead_outside_manager_pool'}
   for(const lead of rows){
     const source=String(lead.source_system||'').toUpperCase();if(source.includes('DEMO')||(source!=='FIELD_ENTRY'&&!batchIds.has(String(lead.import_batch_id||''))))return {ok:false,error:'lead_outside_manager_pool'}
     if(!managerControlsLead(lead,{managerUserId:user.id,adminEmail:scope.adminEmail,reportIds:scope.reportIds}))return {ok:false,error:'lead_outside_manager_pool'}
   }
   return {ok:true}
 }
 const getAssignmentPatch=async(rep:any)=>{
   if(isManager){const scope=await getManagerScope();if(!scope.adminAssigned)return {error:'administrator_assignment_required'};return {patch:{assigned_rep_id:rep?.id||null},assigned_manager_id:user.id,assigned_admin_email:scope.adminEmail,destination_role:rep?.role||'manager_pool'}}
   if(!rep)return {patch:{assigned_rep_id:null,assigned_manager_id:null,assigned_admin_email:null},assigned_manager_id:null,assigned_admin_email:null,destination_role:'unassigned'}
   if(isManagerPermissionRole(rep.role)){
     const ownerEmail=normalizeEmail(rep.assigned_manager_email);if(!ownerEmail)return {error:'manager_administrator_assignment_required'}
     const {data:owner,error:ownerError}=await admin.from('app_user_access').select('email,role,active').eq('email',ownerEmail).eq('role','admin').eq('active',true).maybeSingle();if(ownerError)throw ownerError;if(!owner)return {error:'manager_administrator_assignment_required'}
     const adminEmail=assignedAdminManagerEmail(rep,owner);if(!adminEmail)return {error:'manager_administrator_assignment_required'}
     return {patch:{assigned_rep_id:null,assigned_manager_id:rep.id,assigned_admin_email:adminEmail},assigned_manager_id:rep.id,assigned_admin_email:adminEmail,destination_role:rep.role}
   }
   if(rep.role==='rep'&&rep.assigned_manager_email){
     const {data:manager,error:managerError}=await admin.from('app_user_access').select('email,role,active,assigned_manager_email,assigned_admin_email').eq('email',rep.assigned_manager_email).maybeSingle();if(managerError)throw managerError
     if(isManagerPermissionRole(manager?.role)){
       const ownerEmail=normalizeEmail(manager.assigned_manager_email);if(!manager.active||!ownerEmail)return {error:'manager_administrator_assignment_required'}
       const [{data:profile,error:profileError},{data:owner,error:ownerError}]=await Promise.all([admin.from('users').select('id,active').eq('email',manager.email).maybeSingle(),admin.from('app_user_access').select('email,role,active').eq('email',ownerEmail).eq('role','admin').eq('active',true).maybeSingle()]);if(profileError)throw profileError;if(ownerError)throw ownerError;if(!profile?.active)return {error:'manager_profile_not_found'}
       const adminEmail=assignedAdminManagerEmail(manager,owner);if(!adminEmail)return {error:'manager_administrator_assignment_required'}
       return {patch:{assigned_rep_id:rep.id,assigned_manager_id:profile.id,assigned_admin_email:adminEmail},assigned_manager_id:profile.id,assigned_admin_email:adminEmail,destination_role:'rep'}
     }
   }
   return {patch:{assigned_rep_id:rep.id,assigned_manager_id:null,assigned_admin_email:null},assigned_manager_id:null,assigned_admin_email:null,destination_role:rep.role}
 }
 if(action==='duplicate_status'){
   const {data,error}=await admin.rpc('lead_duplicate_status');if(error)throw error
   return json(data||{ok:true,duplicate_address_groups:0,extra_leads:0,removable_extra_leads:0,blocked_by_active_visits:0,snapshot_token:'none',samples:[]})
 }
 if(action==='delete_lead'){
   const leadId=String(body.lead_id||'');if(!leadId)return json({error:'lead_id_required'},400)
   const {data,error}=await admin.rpc('archive_lead',{p_lead_id:leadId,p_actor_user_id:user.id,p_actor_email:user.email.toLowerCase(),p_actor_role:access.role,p_reason:'manual'});if(error)throw error
   if(!data?.ok)return json(data||{error:'lead_removal_failed'},data?.error==='active_visit_exists'?409:404)
   return json(data)
 }
 if(action==='remove_duplicate_leads'){
   const snapshotToken=String(body.snapshot_token||''),expectedExtra=Math.floor(Number(body.expected_extra_leads));
   if(!snapshotToken||!Number.isFinite(expectedExtra)||expectedExtra<0)return json({error:'verified_duplicate_snapshot_required'},400)
   const {data,error}=await admin.rpc('archive_verified_lead_duplicates',{p_actor_user_id:user.id,p_actor_email:user.email.toLowerCase(),p_actor_role:access.role,p_snapshot_token:snapshotToken,p_expected_extra_leads:expectedExtra});if(error)throw error
   if(!data?.ok)return json(data||{error:'duplicate_cleanup_failed'},data?.error==='duplicate_set_changed'?409:400)
   return json(data)
 }
 if(action==='create_field_address'){
   if(!isAdmin)return json({error:'admin_only'},403)
   const address1=String(body.address1||'').trim(),address2=String(body.address2||'').trim(),city=String(body.city||'').trim(),state=String(body.state||'').trim().toUpperCase(),zip=String(body.zip||'').trim();
   if(address1.length<4)return json({error:'valid_street_address_required'},400);
   if(!city||!state||!zip)return json({error:'complete_address_required'},400);
   if(state.length!==2)return json({error:'state_must_be_two_letters'},400);
   if(!isAdmin){const permittedStates=statesForTeam(access.team_name);if(permittedStates.length&&(!state||!permittedStates.includes(state)))return json({error:'outside_assigned_area'},403);}
   if(!/^\d{5}(?:-\d{4})?$/.test(zip))return json({error:'invalid_zip_code'},400);
   const row:any={address1,address2:address2||null,city:city||null,state:state||null,zip:zip||null,latitude:null,longitude:null,current_disposition:'Uncontacted',source_system:'FIELD_ENTRY',source_id:crypto.randomUUID(),source_payload:{entered_by_email:user.email,entered_by_user_id:user.id,entered_by_role:access.role,entered_by_team:access.team_name||null},geocode_status:'pending_google',geocode_provider:'field_entry',geocode_verification_status:'pending_google'};
   if(!isAdmin){const manager=await getRepresentativeManager();if(manager?.invalid)return json({error:'manager_assignment_required'},403);row.assigned_rep_id=user.id;if(manager){row.assigned_manager_id=manager.id;row.assigned_admin_email=manager.adminEmail}}
   const {data:lead,error}=await admin.from('leads').insert(row).select('id,source_id,address1,address2,city,state,zip,latitude,longitude,geocode_status,geocode_provider,geocode_precision,geocode_verification_status,geocode_comparison_distance_meters,geocode_candidate_latitude,geocode_candidate_longitude,current_disposition,last_activity_type,visit_result,stage,pin_color,pin_color_source,assigned_rep_id,assigned_manager_id,assigned_admin_email,assigned_team_id,source_system,import_batch_id,created_at').single();if(error)throw error;
   return json({ok:true,lead},201)
 }
 if(action==='list_reps'){
   if(isManager){const scope=await getManagerScope();return json({ok:true,reps:scope.adminAssigned?scope.reports.map(({assigned_manager_email,...rep}:any)=>rep):[],administrator_assigned:scope.adminAssigned})}
   const {data:rows,error}=await admin.from('app_user_access').select('email,display_name,role,team_name,assigned_manager_email,assigned_admin_email').eq('active',true).in('role',['rep','manager','trainer','admin']).order('display_name');if(error)throw error
   const authUsers=await getAuthUsers(),reps=(rows||[]).map((account:any)=>{const profile=authUsers.find((candidate:any)=>String(candidate.email||'').toLowerCase()===String(account.email||'').toLowerCase());return {...account,user_id:profile?.id||null}}).filter((account:any)=>account.user_id)
   return json({ok:true,reps})
 }
 if(action==='list_real_leads'){
   const page=Math.max(0,Math.floor(Number(body.page||0)));const limit=Math.min(4000,Math.max(1,Math.floor(Number(body.limit||1000))));const knownTotal=Math.max(0,Math.floor(Number(body.total_hint||0)));
   const {data:batches,error:batchErr}=await admin.from('spotio_import_batches').select('id,created_at,status,raw_payload').eq('status','normalized').order('created_at',{ascending:false}).limit(100);if(batchErr)throw batchErr;
   const normalized=batches||[],canonicalSpotio=normalized.find((batch:any)=>String(batch?.raw_payload?.source_type||'')==='spotio_json'),csvBatches=normalized.filter((batch:any)=>String(batch?.raw_payload?.source_type||'')==='csv');
   const selectedIds=[canonicalSpotio?.id,...csvBatches.map((batch:any)=>batch.id)].filter(Boolean);
   const loadOwnershipDirectory=async()=>{
     let query=admin.from('app_user_access').select('email,display_name,role,team_name,assigned_manager_email,assigned_admin_email').eq('active',true).in('role',['admin','manager','trainer','rep','tester']);
     const {data:accounts,error:accountError}=await query.order('display_name');
     if(accountError)throw accountError;
     const rows=accounts||[],emails=rows.map((account:any)=>String(account.email||'').toLowerCase());
     if(!emails.length)return [];
     const {data:profiles,error:profileError}=await admin.from('users').select('id,email').in('email',emails);
     if(profileError)throw profileError;
     const profileByEmail=new Map((profiles||[]).map((profile:any)=>[String(profile.email||'').toLowerCase(),profile]));
     return rows.map((account:any)=>({user_id:profileByEmail.get(String(account.email||'').toLowerCase())?.id||null,email:account.email,display_name:account.display_name||account.email,role:account.role,team_name:account.team_name||null,assigned_manager_email:account.assigned_manager_email||null,assigned_admin_email:account.assigned_admin_email||null})).filter((account:any)=>account.user_id);
   };
   const makeQuery=(includeCount=false)=>{
     let query=admin.from('leads').select('id,source_id,address1,address2,city,state,zip,latitude,longitude,geocode_status,geocode_provider,geocode_precision,geocode_verification_status,geocode_comparison_distance_meters,geocode_candidate_latitude,geocode_candidate_longitude,current_disposition,last_activity_type,visit_result,stage,pin_color,pin_color_source,assigned_rep_id,assigned_manager_id,assigned_admin_email,assigned_team_id,source_system,import_batch_id,created_at',includeCount?{count:'exact'}:undefined).is('deleted_at',null);
     query=selectedIds.length?query.or(`import_batch_id.in.(${selectedIds.join(',')}),source_system.eq.FIELD_ENTRY`):query.eq('source_system','FIELD_ENTRY');
     query=query.not('source_system','ilike','%demo%');
     return query;
   };
   const metadata={batch_id:csvBatches[0]?.id||canonicalSpotio?.id||null,batch_ids:selectedIds,page,limit,scope:'all_disposition',assigned_team:access.team_name||null,assignment_required:false};
   const ownershipPromise=page===0?loadOwnershipDirectory():Promise.resolve(null);
   const start=page*limit,slices=[];for(let offset=0;offset<limit;offset+=1000)slices.push({start:start+offset,end:start+Math.min(limit,offset+1000)-1});
   const [results,owners]=await Promise.all([Promise.all(slices.map((slice,index)=>makeQuery(index===0&&!knownTotal).order('address1',{ascending:true}).order('id',{ascending:true}).range(slice.start,slice.end))),ownershipPromise]);
   for(const result of results)if(result.error)throw result.error;
   const rows=results.flatMap(result=>result.data||[]),total=knownTotal||Number(results[0]?.count||0);
   return json({ok:true,...metadata,total,leads:rows,...(owners?{owners}:{})});
 }

 if(action==='update_lead'){
   const leadId=String(body.lead_id||'');if(!leadId)return json({error:'lead_id_required'},400);const patch:any={};
   const coordinatesChanged=body.latitude!==undefined||body.longitude!==undefined,addressChanged=['address1','address2','city','state','zip'].some(key=>body[key]!==undefined);
   if(coordinatesChanged){const lat=Number(body.latitude),lng=Number(body.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return json({error:'invalid_coordinates'},400);patch.latitude=lat;patch.longitude=lng;patch.geocode_status='manual';patch.geocode_provider='manual';patch.geocode_precision='door_manual';patch.geocode_verification_status='manual_door_verified';patch.geocode_verified_at=new Date().toISOString();patch.geocode_verification_details={reason:'admin_dragged_pin_to_door'};patch.geocode_attempted_at=new Date().toISOString()}
   if(body.address1!==undefined)patch.address1=String(body.address1||'').trim();if(body.address2!==undefined)patch.address2=String(body.address2||'').trim()||null;if(body.city!==undefined)patch.city=String(body.city||'').trim();if(body.state!==undefined)patch.state=String(body.state||'').trim().toUpperCase();if(body.zip!==undefined)patch.zip=String(body.zip||'').trim();
   if(addressChanged&&!coordinatesChanged){patch.latitude=null;patch.longitude=null;patch.geocode_status='pending_google';patch.geocode_provider='address_edit';patch.geocode_precision=null;patch.geocode_formatted_address=null;patch.geocode_place_id=null;patch.geocode_verified_at=null;patch.geocode_verification_status='pending_google';patch.geocode_comparison_distance_meters=null;patch.geocode_candidate_latitude=null;patch.geocode_candidate_longitude=null;patch.geocode_verification_details={reason:'address_changed_coordinates_invalidated'}}
   if(!Object.keys(patch).length)return json({error:'no_updates'},400);
   const {data,error}=await admin.from('leads').update(patch).eq('id',leadId).is('deleted_at',null).select('id,address1,address2,city,state,zip,latitude,longitude,geocode_status,geocode_provider,geocode_precision,geocode_verification_status,geocode_comparison_distance_meters,geocode_candidate_latitude,geocode_candidate_longitude').maybeSingle();if(error)throw error;if(!data)return json({error:'lead_not_found'},404);return json({ok:true,lead:data})
 }
 if(action==='assign_lead'){
   const leadId=String(body.lead_id||''),repEmail=String(body.rep_email||'').trim().toLowerCase();if(!leadId)return json({error:'lead_id_required'},400)
   let rep:any=null;if(repEmail){rep=await resolveRep(repEmail);if(rep?.forbidden)return json({error:'rep_not_managed_by_you'},403);if(!rep)return json({error:'rep_not_found'},404)}
   const allowed=await managerMayAssign([leadId]);if(!allowed.ok)return json({error:allowed.error},403)
   const destination=await getAssignmentPatch(rep);if(destination.error)return json({error:destination.error},403)
   const {error}=await admin.from('leads').update(destination.patch).eq('id',leadId).is('deleted_at',null);if(error)throw error
   return json({ok:true,lead_id:leadId,rep_email:rep?.email||null,assigned_rep_id:destination.patch.assigned_rep_id||null,assigned_manager_id:destination.assigned_manager_id||null,assigned_admin_email:destination.assigned_admin_email||null,destination_role:destination.destination_role})
 }
 if(action==='assign_leads'){
   const ids=Array.isArray(body.lead_ids)?[...new Set(body.lead_ids.map((id:any)=>String(id)).filter(Boolean))]:[];if(!ids.length)return json({error:'lead_ids_required'},400);if(ids.length>1000)return json({error:'max_1000_leads_per_request'},400)
   const repEmail=String(body.rep_email||'').trim().toLowerCase();let rep:any=null;if(repEmail){rep=await resolveRep(repEmail);if(rep?.forbidden)return json({error:'rep_not_managed_by_you'},403);if(!rep)return json({error:'rep_not_found'},404)}
   const allowed=await managerMayAssign(ids);if(!allowed.ok)return json({error:allowed.error},403)
   const destination=await getAssignmentPatch(rep);if(destination.error)return json({error:destination.error},403)
   let updated=0;const DB_CHUNK=75;for(let i=0;i<ids.length;i+=DB_CHUNK){const chunk=ids.slice(i,i+DB_CHUNK);const {data,error}=await admin.from('leads').update(destination.patch).in('id',chunk).is('deleted_at',null).select('id');if(error)return json({error:'bulk_update_failed',detail:error.message||String(error),updated,failed_chunk_start:i,failed_chunk_size:chunk.length},500);updated+=(data||[]).length}
   return json({ok:true,updated,rep_email:rep?.email||null,assigned_rep_id:destination.patch.assigned_rep_id||null,assigned_manager_id:destination.assigned_manager_id||null,assigned_admin_email:destination.assigned_admin_email||null,destination_role:destination.destination_role})
 }
 return json({error:'unknown_action'},400)
}catch(e){console.error(e);return json({error:'lead_admin_failed',detail:String((e as Error)?.message||e)},500)}})
