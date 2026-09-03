import { createClient } from 'npm:@supabase/supabase-js@2.95.0'

const allowedHeaders='authorization, x-client-info, apikey, content-type, x-mccoy-notes-token'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':allowedHeaders,'Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers})
const encoder=new TextEncoder()
const sha256=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('')
const createToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join('')
const safeString=(value:unknown,max:number)=>String(value??'').trim().slice(0,max)
const validTimestamp=(value:unknown)=>{if(!value)return null;const d=new Date(String(value));return Number.isNaN(d.getTime())?null:d.toISOString()}

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers})
 if(req.method!=='POST')return json({error:'method_not_allowed'},405)
 try{
  const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
  const body=await req.json().catch(()=>null)
  if(!body||typeof body!=='object')return json({error:'invalid_request_body'},400)
  const action=safeString((body as Record<string,unknown>).action,60)

  if(action==='sync_notes'||action==='device_folders'){
   const token=safeString(req.headers.get('x-mccoy-notes-token'),128)
   if(!token)return json({error:'sync_token_required'},401)
   const tokenHash=await sha256(token)
   const {data:connection,error:connectionError}=await admin.from('apple_notes_connections').select('owner_user_id,owner_email,active').eq('token_hash',tokenHash).eq('active',true).maybeSingle()
   if(connectionError)throw connectionError
   if(!connection)return json({error:'invalid_sync_token'},401)
   if(action==='device_folders'){const {data:folders,error:foldersError}=await admin.from('apple_notes_folder_allowlist').select('folder_name,last_synced_at').eq('owner_user_id',connection.owner_user_id).eq('active',true).order('folder_name');if(foldersError)throw foldersError;return json({ok:true,folders:folders||[]})}
   const folderName=safeString((body as Record<string,unknown>).folder,200)
   if(!folderName)return json({error:'folder_required'},400)
   const {data:folder,error:folderError}=await admin.from('apple_notes_folder_allowlist').select('id,folder_name,active').eq('owner_user_id',connection.owner_user_id).eq('folder_name',folderName).eq('active',true).maybeSingle()
   if(folderError)throw folderError
   if(!folder)return json({error:'folder_not_authorized',message:'This exact Apple Notes folder has not been authorized.'},403)
   const sourceNotes=(body as Record<string,unknown>).notes
   if(!Array.isArray(sourceNotes)||sourceNotes.length>100)return json({error:'notes_must_contain_0_to_100_items'},400)
   const rows=[]
   for(const item of sourceNotes){
    if(!item||typeof item!=='object')return json({error:'invalid_note'},400)
    const note=item as Record<string,unknown>,title=safeString(note.title,512),noteBody=String(note.body??'').slice(0,250000)
    if(!title&&!noteBody)return json({error:'empty_note'},400)
    const providedId=safeString(note.id,512)
    const externalId=providedId||await sha256(folderName+'\n'+title)
    rows.push({owner_user_id:connection.owner_user_id,folder_id:folder.id,external_note_id:externalId,title,body:noteBody,source_modified_at:validTimestamp(note.modified_at),synced_at:new Date().toISOString()})
   }
   if(rows.length){const {error:upsertError}=await admin.from('apple_notes_documents').upsert(rows,{onConflict:'owner_user_id,folder_id,external_note_id'});if(upsertError)throw upsertError}
   let deleted=0
   if((body as Record<string,unknown>).full_snapshot===true){const {data:existing,error:existingError}=await admin.from('apple_notes_documents').select('id,external_note_id').eq('owner_user_id',connection.owner_user_id).eq('folder_id',folder.id);if(existingError)throw existingError;const keep=new Set(rows.map(row=>row.external_note_id));const stale=(existing||[]).filter(row=>!keep.has(row.external_note_id)).map(row=>row.id);if(stale.length){const {error:removeError}=await admin.from('apple_notes_documents').delete().eq('owner_user_id',connection.owner_user_id).eq('folder_id',folder.id).in('id',stale);if(removeError)throw removeError;deleted=stale.length}}
   const now=new Date().toISOString()
   await Promise.all([admin.from('apple_notes_connections').update({last_synced_at:now,updated_at:now}).eq('owner_user_id',connection.owner_user_id),admin.from('apple_notes_folder_allowlist').update({last_synced_at:now,updated_at:now}).eq('id',folder.id)])
   return json({ok:true,folder:folder.folder_name,accepted:rows.length,deleted,full_snapshot:(body as Record<string,unknown>).full_snapshot===true})
  }

  const jwt=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'')
  if(!jwt)return json({error:'authentication_required'},401)
  const {data:{user},error:userError}=await admin.auth.getUser(jwt)
  if(userError||!user?.email)return json({error:'authentication_required'},401)
  const {data:access,error:accessError}=await admin.from('app_user_access').select('role,active').eq('email',user.email.toLowerCase()).maybeSingle()
  if(accessError)throw accessError
  if(!access?.active||access.role!=='admin')return json({error:'admin_only'},403)

  const ensureConnection=async()=>{const {error}=await admin.from('apple_notes_connections').upsert({owner_user_id:user.id,owner_email:user.email.toLowerCase()},{onConflict:'owner_user_id',ignoreDuplicates:true});if(error)throw error}

  if(action==='status'){
   await ensureConnection()
   const [connectionResult,foldersResult]=await Promise.all([admin.from('apple_notes_connections').select('active,created_at,last_synced_at').eq('owner_user_id',user.id).single(),admin.from('apple_notes_folder_allowlist').select('id,folder_name,active,created_at,last_synced_at').eq('owner_user_id',user.id).order('folder_name')])
   if(connectionResult.error)throw connectionResult.error
   if(foldersResult.error)throw foldersResult.error
   const activeIds=(foldersResult.data||[]).filter(x=>x.active).map(x=>x.id)
   let noteCount=0
   if(activeIds.length){const counted=await admin.from('apple_notes_documents').select('id',{count:'exact',head:true}).eq('owner_user_id',user.id).in('folder_id',activeIds);if(counted.error)throw counted.error;noteCount=counted.count||0}
   return json({ok:true,connection:connectionResult.data,folders:foldersResult.data||[],note_count:noteCount,endpoint:url+'/functions/v1/apple-notes-sync'})
  }

  if(action==='authorize_folder'){
   await ensureConnection()
   const name=safeString((body as Record<string,unknown>).folder_name,200)
   if(!name)return json({error:'folder_name_required'},400)
   const {data:existing,error:findError}=await admin.from('apple_notes_folder_allowlist').select('id,folder_name').eq('owner_user_id',user.id).ilike('folder_name',name.replace(/[\\%_]/g,'\\$&')).maybeSingle()
   if(findError)throw findError
   if(existing){const {error}=await admin.from('apple_notes_folder_allowlist').update({folder_name:name,active:true,updated_at:new Date().toISOString()}).eq('id',existing.id);if(error)throw error}
   else{const {error}=await admin.from('apple_notes_folder_allowlist').insert({owner_user_id:user.id,folder_name:name,active:true});if(error)throw error}
   return json({ok:true,folder_name:name})
  }

  if(action==='remove_folder'){
   const folderId=safeString((body as Record<string,unknown>).folder_id,60)
   const {data:folder,error:findError}=await admin.from('apple_notes_folder_allowlist').select('id').eq('id',folderId).eq('owner_user_id',user.id).maybeSingle()
   if(findError)throw findError
   if(!folder)return json({error:'folder_not_found'},404)
   const {error:deleteNotes}=await admin.from('apple_notes_documents').delete().eq('folder_id',folder.id).eq('owner_user_id',user.id)
   if(deleteNotes)throw deleteNotes
   const {error:updateError}=await admin.from('apple_notes_folder_allowlist').update({active:false,updated_at:new Date().toISOString()}).eq('id',folder.id)
   if(updateError)throw updateError
   return json({ok:true})
  }

  if(action==='rotate_token'){
   await ensureConnection()
   const token=createToken(),hash=await sha256(token)
   const {error}=await admin.from('apple_notes_connections').update({token_hash:hash,active:true,updated_at:new Date().toISOString()}).eq('owner_user_id',user.id)
   if(error)throw error
   return json({ok:true,token,endpoint:url+'/functions/v1/apple-notes-sync'})
  }

  if(action==='disconnect'){
   const {error}=await admin.from('apple_notes_connections').update({token_hash:null,active:false,updated_at:new Date().toISOString()}).eq('owner_user_id',user.id)
   if(error)throw error
   return json({ok:true})
  }

  if(action==='list_notes'){
   const folderId=safeString((body as Record<string,unknown>).folder_id,60)
   const {data:folder,error:folderError}=await admin.from('apple_notes_folder_allowlist').select('id,folder_name').eq('id',folderId).eq('owner_user_id',user.id).eq('active',true).maybeSingle()
   if(folderError)throw folderError
   if(!folder)return json({error:'folder_not_authorized'},403)
   const {data:notes,error:noteError}=await admin.from('apple_notes_documents').select('id,title,body,source_modified_at,synced_at').eq('owner_user_id',user.id).eq('folder_id',folder.id).order('synced_at',{ascending:false}).limit(100)
   if(noteError)throw noteError
   return json({ok:true,folder:folder.folder_name,notes:notes||[]})
  }

  return json({error:'unknown_action'},400)
 }catch(error){console.error('Apple Notes sync failed',error);return json({error:'apple_notes_sync_failed',detail:String((error as Error)?.message||error)},500)}
})