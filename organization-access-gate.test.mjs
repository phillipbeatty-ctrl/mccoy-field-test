import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const read=path=>readFile(new URL(path,import.meta.url),'utf8')

const [migration,permissionMigration,client,indexHtml,edge,serviceWorker]=await Promise.all([
  read('./supabase/migrations/20260901033000_organization_access_paywall_gate.sql'),
  read('./supabase/migrations/20260901033100_organization_access_policy_execute_permission.sql'),
  read('./app-organization-access-gate.js'),
  read('./index.html'),
  read('./supabase/functions/organization-access/index.ts'),
  read('./service-worker.js')
])

class FakeClassList{
  constructor(){this.values=new Set()}
  add(...values){for(const value of values)this.values.add(value)}
  remove(...values){for(const value of values)this.values.delete(value)}
  contains(value){return this.values.has(value)}
}

class FakeElement{
  constructor(tagName,document){
    this.tagName=String(tagName||'div').toUpperCase()
    this.ownerDocument=document
    this.classList=new FakeClassList()
    this.style={}
    this.hidden=false
    this.disabled=false
    this.textContent=''
    this.listeners=new Map()
    this._id=''
    this._innerHTML=''
  }
  set id(value){
    this._id=String(value)
    if(this._id)this.ownerDocument.elements.set(this._id,this)
  }
  get id(){return this._id}
  set innerHTML(value){
    this._innerHTML=String(value)
    for(const match of this._innerHTML.matchAll(/id="([^"]+)"/g)){
      if(this.ownerDocument.elements.has(match[1]))continue
      const child=new FakeElement('div',this.ownerDocument)
      child.id=match[1]
    }
  }
  get innerHTML(){return this._innerHTML}
  setAttribute(){}
  appendChild(child){return child}
  prepend(child){return child}
  addEventListener(type,listener){
    const listeners=this.listeners.get(type)||[]
    listeners.push(listener)
    this.listeners.set(type,listeners)
  }
}

class FakeDocument{
  constructor(){
    this.elements=new Map()
    this.body=new FakeElement('body',this)
    this.head=new FakeElement('head',this)
  }
  createElement(tagName){return new FakeElement(tagName,this)}
  getElementById(id){return this.elements.get(id)||null}
}

class FakeEvent{
  constructor(type,init={}){
    this.type=type
    this.detail=init.detail
    this.immediatePropagationStopped=false
  }
  stopImmediatePropagation(){this.immediatePropagationStopped=true}
}
class FakeCustomEvent extends FakeEvent{}

class FakeWindow{
  constructor(){this.listeners=new Map()}
  addEventListener(type,listener){
    const listeners=this.listeners.get(type)||[]
    listeners.push(listener)
    this.listeners.set(type,listeners)
  }
  dispatchEvent(event){
    for(const listener of this.listeners.get(event.type)||[]){
      listener.call(this,event)
      if(event.immediatePropagationStopped)break
    }
    return true
  }
}

async function nextTurn(){
  await new Promise(resolve=>setImmediate(resolve))
}

function organizationAccessHarness(states){
  const document=new FakeDocument()
  const window=new FakeWindow()
  let invokeCount=0
  const responses=[...states]
  const sb={
    functions:{
      invoke:async()=>{
        invokeCount+=1
        const organization_access=responses.shift()||{access_allowed:true,organization_name:'McCoy Platform LLC'}
        return {data:{organization_access},error:null}
      }
    },
    auth:{signOut:async()=>({error:null})}
  }
  const context={
    window,
    document,
    sb,
    Event:FakeEvent,
    CustomEvent:FakeCustomEvent,
    location:{reload(){}},
    console,
    setTimeout,
    clearTimeout
  }
  vm.runInNewContext(client,context,{filename:'app-organization-access-gate.js'})
  return {document,window,invokeCount:()=>invokeCount}
}

test('database gate combines organization, billing, entitlement, period, grace, and seat state',()=>{
  assert.match(migration,/organization_access_state\s*\(/)
  assert.match(migration,/billing_status='internal_unlimited'/)
  assert.match(migration,/billing_status='trial_active'/)
  assert.match(migration,/current_period_end<=now\(\)/)
  assert.match(migration,/billing_status='paid_active'/)
  assert.match(migration,/billing_status='past_due_grace'/)
  assert.match(migration,/grace_period_end<=now\(\)/)
  assert.match(migration,/entitlement_disabled/)
  assert.match(migration,/seat_limit_exceeded/)
  assert.match(migration,/purchase_model', 'organization_managed_external'/)
  assert.match(migration,/purchase_action_available', false/)
})

test('active legacy access rows are backfilled into memberships',()=>{
  assert.match(migration,/insert into public\.organization_memberships/)
  assert.match(migration,/join auth\.users auth_user/)
  assert.match(migration,/not exists \(\s*select 1\s*from public\.organization_memberships existing/)
})

test('RLS receives a restrictive organization subscription gate',()=>{
  assert.match(migration,/create policy organization_subscription_gate/)
  assert.match(migration,/as restrictive for all to authenticated/)
  assert.match(migration,/private\.organization_access_allowed\(organization_id,%L\)/)
  assert.match(permissionMigration,/grant execute on function private\.organization_access_allowed\(uuid,text\) to authenticated/)
})

test('client blocks the first access-ready event until verified',()=>{
  assert.match(client,/event\.stopImmediatePropagation\(\)/)
  assert.match(client,/window\.MCCOY_ACCESS=\{user:current\.user,access:null\}/)
  assert.match(client,/sb\.functions\.invoke\('organization-access'/)
  assert.match(client,/organization_access_verified/)
  assert.match(client,/purchase_action_available:false/)
  assert.doesNotMatch(client,/stripe|checkout|subscribe now|buy now/i)
})

test('successful verification is reused for repeated auth refresh events from the same user',()=>{
  assert.match(client,/let verifiedUserKey=null/)
  assert.match(client,/function userKey\(user\)/)
  assert.match(client,/function hasVerifiedAccessFor\(current\)/)
  assert.match(client,/verifiedUserKey=userKey\(accessSnapshot\?\.user\)/)
  assert.match(client,/organizationState\?\.access_allowed===true/)

  const reuse=client.indexOf('if(hasVerifiedAccessFor(current))')
  const firstInterceptionAfterReuse=client.indexOf('event.stopImmediatePropagation()',reuse)
  assert.ok(reuse>=0,'same-user verified-access reuse guard is missing')
  assert.ok(firstInterceptionAfterReuse>reuse,'reuse guard must run before event interception')
  assert.match(client.slice(reuse,firstInterceptionAfterReuse),/hideGate\(\);\s*return;/)
})

test('same-user auth replays do not reopen the gate or repeat the server check',async()=>{
  const harness=organizationAccessHarness([
    {access_allowed:true,organization_name:'McCoy Platform LLC'},
    {access_allowed:true,organization_name:'McCoy Platform LLC'}
  ])
  let releasedEvents=0
  harness.window.addEventListener('mccoy-access-ready',()=>{releasedEvents+=1})

  harness.window.MCCOY_ACCESS={user:{id:'user-1',email:'one@example.com'},access:{active:true,role:'admin'}}
  harness.window.dispatchEvent(new FakeEvent('mccoy-access-ready'))
  await nextTurn()

  assert.equal(harness.invokeCount(),1)
  assert.equal(releasedEvents,1,'the verified replay should release the application exactly once')
  assert.equal(harness.document.body.classList.contains('organization-access-blocked'),false)
  assert.equal(harness.document.getElementById('organizationAccessGate')?.classList.contains('show'),false)

  harness.window.MCCOY_ACCESS={user:{id:'user-1',email:'one@example.com'},access:{active:true,role:'admin'}}
  harness.window.dispatchEvent(new FakeEvent('mccoy-access-ready'))
  await nextTurn()

  assert.equal(harness.invokeCount(),1,'same-user auth replay must reuse the successful page verification')
  assert.equal(releasedEvents,2,'the normal auth replay may continue without the blocking overlay')
  assert.equal(harness.document.body.classList.contains('organization-access-blocked'),false)
  assert.equal(harness.document.getElementById('organizationAccessGate')?.classList.contains('show'),false)

  harness.window.MCCOY_ACCESS={user:{id:'user-2',email:'two@example.com'},access:{active:true,role:'rep'}}
  harness.window.dispatchEvent(new FakeEvent('mccoy-access-ready'))
  await nextTurn()

  assert.equal(harness.invokeCount(),2,'a different signed-in user must receive a fresh server verification')
  assert.equal(releasedEvents,3)
})

test('denial and a different signed-in user invalidate the page verification cache',()=>{
  assert.match(client,/function showDenied\(state\)\{\s*verifiedUserKey=null;/)
  assert.match(client,/if\(verifiedUserKey&&verifiedUserKey!==currentUserKey\)/)
  assert.match(client,/organizationState=null;\s*window\.FIELD_COACH_ORGANIZATION_ACCESS=null;/)
})

test('organization gate loads before application modules with a fresh iOS cache key',()=>{
  const gate=indexHtml.indexOf('app-organization-access-gate.js?v=2026090402')
  const firstApp=indexHtml.indexOf('app-part1.js')
  const auth=indexHtml.indexOf('app-auth.js')
  assert.ok(gate>=0,'cache-busted organization gate script missing')
  assert.ok(gate<firstApp,'organization gate must load before app-part1')
  assert.ok(gate<auth,'organization gate must load before app-auth')
})

test('service worker rotates the app shell and precaches the cache-busted organization gate',()=>{
  assert.match(serviceWorker,/field-coach-app-shell-v22-20260911-knock-door/)
  assert.match(serviceWorker,/'\/app-organization-access-gate\.js\?v=2026090402'/)
  assert.match(serviceWorker,/'\/app-sph-home-admin-only\.js\?v=2026090502'/)
})

test('Edge endpoint validates JWT and restricts entitlement names',()=>{
  assert.match(edge,/admin\.auth\.getUser\(jwt\)/)
  assert.match(edge,/ENTITLEMENTS=new Set/)
  assert.match(edge,/service_organization_access_state/)
  assert.match(edge,/'Cache-Control':'no-store'/)
})
