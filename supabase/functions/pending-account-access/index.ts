// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.95.0'
import { corsHeaders } from 'npm:@supabase/supabase-js@2.95.0/cors'

const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,
  headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}
})
const lower=value=>String(value||'').trim().toLowerCase()

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)
  try{
    const authorization=request.headers.get('Authorization')||''
    const jwt=authorization.replace(/^Bearer\s+/,'')
    if(!jwt)return json({error:'unauthorized'},401)

    const url=Deno.env.get('SUPABASE_URL')
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:{user},error:userError}=await admin.auth.getUser(jwt)
    if(userError||!user?.email)return json({error:'unauthorized'},401)

    const callerEmail=lower(user.email)
    const {data:caller,error:callerError}=await admin.from('app_user_access')
      .select('email,role,active,organization_id')
      .eq('email',callerEmail)
      .maybeSingle()
    if(callerError)throw callerError
    if(!caller?.active||caller.role!=='admin'||!caller.organization_id)return json({error:'admin_only'},403)

    const authUsers=[]
    for(let page=1;page<=20;page++){
      const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000})
      if(error)throw error
      const pageUsers=data?.users||[]
      authUsers.push(...pageUsers)
      if(pageUsers.length<1000)break
    }

    const [{data:accessRows,error:accessError},{data:requestRows,error:requestError},{data:membershipRows,error:membershipError}]=await Promise.all([
      admin.from('app_user_access')
        .select('email,display_name,role,active,created_at,organization_id')
        .eq('organization_id',caller.organization_id),
      admin.from('rep_access_requests')
        .select('id,user_id,email,display_name,requested_role,requested_team,status,created_at,reviewed_at')
        .order('created_at',{ascending:false}),
      admin.from('organization_memberships')
        .select('auth_user_id,organization_id,active')
        .eq('active',true)
    ])
    if(accessError)throw accessError
    if(requestError)throw requestError
    if(membershipError)throw membershipError

    const accessByEmail=new Map((accessRows||[]).map(row=>[lower(row.email),row]))
    const latestRequestByUser=new Map()
    for(const row of requestRows||[]){
      const key=String(row.user_id||'')
      if(key&&!latestRequestByUser.has(key))latestRequestByUser.set(key,row)
    }
    const organizationsByUser=new Map()
    for(const row of membershipRows||[]){
      const key=String(row.auth_user_id||'')
      if(!key)continue
      const organizations=organizationsByUser.get(key)||new Set()
      organizations.add(String(row.organization_id||''))
      organizationsByUser.set(key,organizations)
    }

    const accounts=[]
    for(const account of authUsers){
      const email=lower(account.email)
      if(!email||account.is_anonymous||account.deleted_at)continue
      const memberships=organizationsByUser.get(String(account.id))
      if(memberships?.size&&!memberships.has(String(caller.organization_id)))continue
      const access=accessByEmail.get(email)||null
      const request=latestRequestByUser.get(String(account.id))||null
      const emailConfirmedAt=account.email_confirmed_at||account.confirmed_at||null
      const requestPending=request?.status==='pending'
      const accessActive=access?.active===true
      if(emailConfirmedAt&&accessActive&&!requestPending)continue

      const metadata=account.user_metadata||{}
      const metadataName=String(metadata.full_name||metadata.display_name||metadata.name||[metadata.first_name,metadata.last_name].filter(Boolean).join(' ')||'').trim()
      const name=String(request?.display_name||access?.display_name||metadataName||email).trim()
      const accessState=!emailConfirmedAt
        ?'email_unconfirmed'
        :requestPending
          ?'approval_requested'
          :access
            ?'access_inactive'
            :'no_access_record'

      accounts.push({
        email,
        display_name:name,
        role:access?.role||request?.requested_role||'rep',
        account_created_at:account.created_at||null,
        email_confirmed_at:emailConfirmedAt,
        last_sign_in_at:account.last_sign_in_at||null,
        access_state:accessState,
        access_active:accessActive,
        requires_access_grant:!accessActive,
        waiting_for_email_confirmation:!emailConfirmedAt,
        request:request?{
          id:request.id,
          status:request.status,
          requested_role:request.requested_role,
          requested_team:request.requested_team,
          created_at:request.created_at,
          reviewed_at:request.reviewed_at
        }:null
      })
    }

    accounts.sort((left,right)=>String(right.account_created_at||'').localeCompare(String(left.account_created_at||'')))
    return json({ok:true,accounts,count:accounts.length,generated_at:new Date().toISOString()})
  }catch(error){
    console.error('pending-account-access failed',error)
    return json({error:'pending_account_access_failed'},500)
  }
})
