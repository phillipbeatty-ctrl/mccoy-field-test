import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const helperSource=readFileSync(new URL('./app-supabase-client.js',import.meta.url),'utf8')
const lifecycleSource=readFileSync(new URL('./app-sale-lifecycle.js',import.meta.url),'utf8')
const photoSource=readFileSync(new URL('./app-sale-photo-staging.js',import.meta.url),'utf8')
const salesSource=readFileSync(new URL('./app-sales.js',import.meta.url),'utf8')
const productsSource=readFileSync(new URL('./app-sales-products.js',import.meta.url),'utf8')
const customerRefreshSource=readFileSync(new URL('./app-customer-list-credit-ranking-refresh.js',import.meta.url),'utf8')
const indexSource=readFileSync(new URL('./index.html',import.meta.url),'utf8')
const workerSource=readFileSync(new URL('./service-worker.js',import.meta.url),'utf8')
const saleSubmitSource=readFileSync(new URL('./supabase/functions/sale-submit/index.ts',import.meta.url),'utf8')
const captureSource=readFileSync(new URL('./supabase/functions/provider-sale-capture/index.ts',import.meta.url),'utf8')

class MemoryStorage{
  constructor(){this.values=new Map()}
  getItem(key){return this.values.has(String(key))?this.values.get(String(key)):null}
  setItem(key,value){this.values.set(String(key),String(value))}
  removeItem(key){this.values.delete(String(key))}
}

class Bus{
  constructor(){this.listeners=new Map()}
  addEventListener(type,listener){
    if(!this.listeners.has(type))this.listeners.set(type,[])
    this.listeners.get(type).push(listener)
  }
  removeEventListener(type,listener){
    const rows=this.listeners.get(type)||[]
    this.listeners.set(type,rows.filter(row=>row!==listener))
  }
  dispatchEvent(event){
    for(const listener of this.listeners.get(event.type)||[])listener.call(this,event)
    return !event.defaultPrevented
  }
  async emit(type,event={}){
    event.type=type
    const results=[]
    for(const listener of this.listeners.get(type)||[])results.push(listener.call(this,event))
    await Promise.all(results.map(value=>Promise.resolve(value)))
  }
}

class ClassList{
  constructor(){this.values=new Set()}
  add(...names){names.forEach(name=>this.values.add(name))}
  remove(...names){names.forEach(name=>this.values.delete(name))}
  toggle(name,force){
    if(force===true){this.values.add(name);return true}
    if(force===false){this.values.delete(name);return false}
    if(this.values.has(name)){this.values.delete(name);return false}
    this.values.add(name);return true
  }
  contains(name){return this.values.has(name)}
}

class Element extends Bus{
  constructor(tagName,document){
    super();this.tagName=String(tagName).toUpperCase();this.ownerDocument=document;this.children=[];this.parentNode=null;this.parentElement=null;this.dataset={};this.style={cssText:''};this.classList=new ClassList();this.attributes=new Map();this._id='';this._textContent='';this.value='';this.files=[];this.disabled=false;this.hidden=false;this.type='';this.accept='';this.tabIndex=0;this.title='';this.className=''
  }
  set id(value){
    if(this._id)this.ownerDocument.elements.delete(this._id)
    this._id=String(value||'')
    if(this._id)this.ownerDocument.elements.set(this._id,this)
  }
  get id(){return this._id}
  set textContent(value){this._textContent=String(value??'');this.children=[]}
  get textContent(){return this._textContent+this.children.map(child=>child.textContent||'').join('')}
  setAttribute(name,value){this.attributes.set(name,String(value));if(name==='id')this.id=value}
  removeAttribute(name){this.attributes.delete(name);if(name==='hidden')this.hidden=false}
  appendChild(child){child.parentNode=this;child.parentElement=this;this.children.push(child);return child}
  append(...children){children.forEach(child=>this.appendChild(child))}
  replaceChildren(...children){this.children=[];this._textContent='';this.append(...children)}
  insertAdjacentElement(_position,element){
    const parent=this.parentElement||this.ownerDocument.body
    return parent.appendChild(element)
  }
  closest(selector){
    if(selector===`.nav-btn[data-view="field"]`)return null
    if(selector.startsWith('#'))return selector.split(',').some(item=>item.trim().slice(1)===this.id)?this:null
    return null
  }
  focus(){}
  scrollIntoView(){}
  async click(){await this.emit('click',{target:this,preventDefault(){this.defaultPrevented=true},stopImmediatePropagation(){this.immediateStopped=true}})}
}

class MiniDocument extends Bus{
  constructor(){
    super();this.elements=new Map();this.body=new Element('body',this);this.head=new Element('head',this);this.readyState='complete';this.actions=new Element('div',this);this.actions.className='spotio-disposition-actions';this.body.appendChild(this.actions)
  }
  createElement(tagName){return new Element(tagName,this)}
  getElementById(id){return this.elements.get(String(id))||null}
  querySelector(selector){
    if(selector==='.spotio-disposition-actions')return this.actions
    return null
  }
  querySelectorAll(){return[]}
}

class MiniCustomEvent{
  constructor(type,options={}){this.type=type;this.detail=options.detail;this.defaultPrevented=false}
  preventDefault(){this.defaultPrevented=true}
  stopImmediatePropagation(){this.immediateStopped=true}
}

function createBrowserContext(client,{timers='disabled'}={}){
  const document=new MiniDocument()
  const context={
    console,
    __client:client,
    document,
    localStorage:new MemoryStorage(),
    CustomEvent:MiniCustomEvent,
    Event:class{constructor(type,options={}){this.type=type;this.bubbles=options.bubbles}},
    URL,
    Promise,
    Date,
    Math,
    JSON,
    queueMicrotask,
    crypto:globalThis.crypto,
    alert(){},
    setTimeout:timers==='immediate'?((callback)=>{callback();return 0}):(()=>0),
    clearTimeout(){},
    setInterval:()=>0,
    clearInterval(){},
  }
  Object.setPrototypeOf(context,new Bus())
  context.listeners=new Map()
  context.addEventListener=Bus.prototype.addEventListener
  context.removeEventListener=Bus.prototype.removeEventListener
  context.dispatchEvent=Bus.prototype.dispatchEvent
  context.emit=Bus.prototype.emit
  context.window=context
  context.globalThis=context
  vm.createContext(context)
  vm.runInContext('const sb=__client;',context)
  vm.runInContext(helperSource,context)
  return context
}

function extractFunction(source,name){
  const marker=`async function ${name}(`
  const start=source.indexOf(marker)
  assert.notEqual(start,-1,`${name} must exist`)
  const open=source.indexOf('{',start)
  let depth=0,quote=null,escaped=false,templateDepth=0
  for(let index=open;index<source.length;index++){
    const char=source[index]
    if(quote){
      if(escaped){escaped=false;continue}
      if(char==='\\'){escaped=true;continue}
      if(quote==='`'&&char==='$'&&source[index+1]==='{'){templateDepth++;index++;continue}
      if(quote==='`'&&char==='}'&&templateDepth>0){templateDepth--;continue}
      if(char===quote&&templateDepth===0)quote=null
      continue
    }
    if(char==='"'||char==="'"||char==='`'){quote=char;continue}
    if(char==='{')depth++
    if(char==='}'){
      depth--
      if(depth===0)return source.slice(start,index+1)
    }
  }
  throw new Error(`Unable to extract ${name}`)
}

function completionHarness({serverError=null}={}){
  const model={
    capture:{id:'capture-1',status:'details_required',sale_context:'field',service_address:'100 Test Ave',session_id:null},
    sales:[],adminReview:[],rankingCount:0,feedRefreshes:0,rankingRefreshes:0,doorCompletions:0,events:[],messages:[],modalHidden:false,clearedCapture:null,submitCalls:0
  }
  const client={
    auth:{getSession:async()=>({data:{session:{access_token:'test'}},error:null})},
    functions:{invoke:async(name,options)=>{
      assert.equal(name,'sale-submit')
      model.submitCalls++
      if(serverError)return{data:{ok:false,error:serverError},error:null}
      assert.equal(options.body.provider_capture_id,model.capture.id)
      const sale={id:'sale-1',provider_capture_id:model.capture.id,ranking_eligible:true,rep_reported_outcome:'completed'}
      model.sales.push(sale)
      model.capture.status='recorded'
      model.adminReview.push(sale)
      model.rankingCount++
      return{data:{ok:true,sale_id:sale.id,verification:{ranking_eligible:true,status:'pending_verification'}},error:null}
    }}
  }
  const context=createBrowserContext(client)
  Object.assign(context,{
    state:{},
    telemetrySessionId:null,
    submitting:false,lockedOutcome:null,
    freezeOutcome:()=>({capture:model.capture,account:'actor:org'}),
    currentOutcome:()=>true,
    finishReturn:()=>{model.modalHidden=true},
    byId:()=>null,
    setOutcomeButtonsBusy(){},
    setSaleMsg(text,type=''){model.messages.push({text,type})},
    readyCapture:async()=>model.capture,
    selectedSaleLead:()=>null,
    saleDistanceInput:async()=>({}),
    isTesterPkbSale:()=>false,
    functionErrorDetail:async(error,data)=>String(data?.detail||data?.error||error?.message||'').replace(/_/g,' '),
    clearCompletedCapture:captureId=>{model.clearedCapture=captureId},
    modal:{classList:{remove(name){if(name==='show')model.modalHidden=true}}},
    loadFeed:async()=>{model.feedRefreshes++},
  })
  context.MCCOY_REFRESH_RANKINGS=async()=>{model.rankingRefreshes++}
  context.MCCOY_COMPLETE_DOOR_VISIT=async()=>{model.doorCompletions++}
  context.dispatchEvent=event=>{model.events.push(event);return true}
  const functionSource=extractFunction(salesSource,'completeSale')
  vm.runInContext(`${functionSource}\nglobalThis.__completeSale=completeSale;`,context)
  return{context,model}
}

test('the shared resolver returns the lexical Supabase client even when window.sb is absent',()=>{
  const client={auth:{getSession(){}},functions:{invoke(){}},storage:{from(){}},rpc(){}}
  const context=createBrowserContext(client)
  assert.equal(context.sb,undefined)
  assert.equal(context.MCCOY_GET_SUPABASE_CLIENT({functions:true}),client)
  assert.equal(context.MCCOY_GET_SUPABASE_CLIENT({storage:true}),client)
  assert.equal(context.MCCOY_GET_SUPABASE_CLIENT({rpc:true}),client)
})

test('the lifecycle no longer intercepts COMPLETE SALE and still restores current-user captures',async()=>{
  let listCalls=0
  const capture={id:'capture-1',client_request_id:'request-1',provider:'Quantum',status:'details_required'}
  const client={functions:{invoke:async(name,options)=>{
    assert.equal(name,'provider-sale-capture')
    assert.equal(JSON.stringify(options.body),JSON.stringify({action:'list',open_only:true,mine_only:true}))
    listCalls++
    return{data:{ok:true,captures:[capture]},error:null}
  }}}
  const context=createBrowserContext(client)
  context.MCCOY_ACCESS={user:{id:'actor'},access:{active:true,organization_id:'org'}}
  vm.runInContext(lifecycleSource,context)

  const event={
    target:{closest:selector=>selector==='#completeSaleBtn,#abandonedSaleBtn'?{id:'completeSaleBtn'}:null},
    prevented:false,stopped:false,
    preventDefault(){this.prevented=true},
    stopImmediatePropagation(){this.stopped=true}
  }
  await context.document.emit('click',event)
  assert.equal(event.prevented,false)
  assert.equal(event.stopped,false)
  assert.doesNotMatch(lifecycleSource,/mccoyCaptureValidated|CHECKING CAPTURE/)

  const restored=await context.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE()
  assert.equal(restored.id,capture.id)
  assert.equal(listCalls,1)
})

test('one COMPLETE SALE execution creates one sale, records the capture, reaches Admin Review, and refreshes rankings',async()=>{
  const {context,model}=completionHarness()
  await context.__completeSale()
  assert.equal(model.submitCalls,1)
  assert.equal(model.sales.length,1)
  assert.equal(model.capture.status,'recorded')
  assert.equal(model.adminReview.length,1)
  assert.equal(model.rankingCount,1)
  assert.equal(model.feedRefreshes,1)
  assert.equal(model.rankingRefreshes,1)
  assert.equal(model.clearedCapture,'capture-1')
  assert.equal(model.modalHidden,true)
  assert.equal(model.events.filter(event=>event.type==='mccoy-sale-saved').length,1)
  assert.equal(model.doorCompletions,1)
})

for(const serverError of ['provider_capture_not_open','provider_capture_not_found']){
  test(`${serverError} remains blocked by sale-submit and its error stays visible`,async()=>{
    const {context,model}=completionHarness({serverError})
    await context.__completeSale()
    assert.equal(model.submitCalls,1)
    assert.equal(model.sales.length,0)
    assert.equal(model.adminReview.length,0)
    assert.equal(model.rankingCount,0)
    assert.equal(model.modalHidden,false)
    assert.equal(model.rankingRefreshes,0)
    const last=model.messages.at(-1)
    assert.equal(last.type,'error')
    assert.match(last.text,new RegExp(serverError.replaceAll('_',' '),'i'))
  })
}

test('PHOTO uses the shared client, uploads to the staged bucket, and commits the photo row',async()=>{
  const calls=[]
  const stagedRows=[]
  const capture={id:'capture-photo-1',client_request_id:'request-photo-1',provider:'Quantum',status:'details_required'}
  const client={
    functions:{invoke:async(name,options)=>{
      calls.push({kind:'function',name,body:options.body})
      assert.equal(name,'provider-sale-photo-stage')
      const action=options.body.action
      if(action==='list')return{data:{ok:true,rows:[...stagedRows]},error:null}
      if(action==='create_upload')return{data:{ok:true,photo_id:'photo-1',path:'org/capture/photo.jpg',token:'signed-token'},error:null}
      if(action==='commit_upload'){stagedRows.push({id:'photo-1',status:'staged'});return{data:{ok:true},error:null}}
      if(action==='abort_upload')return{data:{ok:true},error:null}
      throw new Error(`Unexpected action ${action}`)
    }},
    storage:{from:bucket=>({uploadToSignedUrl:async(path,token,file,options)=>{
      calls.push({kind:'storage',bucket,path,token,file,options})
      return{error:null}
    }})}
  }
  const context=createBrowserContext(client,{timers:'immediate'})
  context.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE=async()=>capture
  vm.runInContext(photoSource,context)
  context.dispatchEvent(new MiniCustomEvent('mccoy-provider-sale-capture-started',{detail:{capture}}))
  context.dispatchEvent(new MiniCustomEvent('mccoy-provider-sale-capture-ready',{detail:{capture}}))
  await Promise.resolve();await Promise.resolve()

  const input=context.document.getElementById('salePhotoStageInput')
  assert.ok(input)
  input.files=[{name:'provider-order.png',type:'image/png',size:125000}]
  await input.emit('change',{target:input})

  assert.ok(calls.some(call=>call.kind==='function'&&call.body.action==='create_upload'))
  assert.ok(calls.some(call=>call.kind==='storage'&&call.bucket==='provider-sale-staged-photos'))
  assert.ok(calls.some(call=>call.kind==='function'&&call.body.action==='commit_upload'))
  assert.match(context.document.getElementById('salePhotoStageStatus').textContent,/1 photo staged/i)
})

test('client and cache contracts ship the fixed runtime to web, PWA, iOS, and Android bundles',()=>{
  for(const source of [lifecycleSource,photoSource,productsSource,customerRefreshSource]){
    assert.doesNotMatch(source,/window\.sb\?\./)
    assert.match(source,/MCCOY_(GET|REQUIRE)_SUPABASE_CLIENT/)
  }
  assert.match(indexSource,/app-supabase-client\.js\?v=2026090201/)
  assert.ok(indexSource.indexOf('app-supabase-client.js?v=2026090201')<indexSource.indexOf('app-sales.js?v='))
  assert.match(indexSource,/app-sales-products\.js\?v=2026091105/)
  assert.match(indexSource,/app-customer-list-credit-ranking-refresh\.js\?v=2026090201/)
  assert.ok(indexSource.indexOf('app-sale-photo-staging.js?v=2026091201')<indexSource.indexOf('app-page-layout.js'))
  assert.match(indexSource,/app-sale-lifecycle\.js\?v=2026091201/)
  assert.match(indexSource,/app-sale-photo-staging\.js\?v=2026091201/)
  assert.match(workerSource,/field-coach-app-shell-v25-20260912-provider-return/)
  assert.match(workerSource,/app-supabase-client\.js\?v=2026090201/)
  assert.match(workerSource,/app-sale-lifecycle\.js\?v=2026091201/)
  assert.match(workerSource,/app-sale-photo-staging\.js\?v=2026091201/)
})

test('server contracts remain authoritative for owner/status checks, canonical sale insert, recorded capture, review, and ranking',()=>{
  assert.match(saleSubmitSource,/\.eq\('rep_user_id', user\.id\)/)
  assert.match(saleSubmitSource,/provider_capture_not_found/)
  assert.match(saleSubmitSource,/provider_capture_not_open/)
  assert.match(saleSubmitSource,/\.from\('sales_records'\)[\s\S]*\.insert\(saleRow\)/)
  assert.match(saleSubmitSource,/status: 'recorded', rep_outcome: 'completed'/)
  assert.match(saleSubmitSource,/ranking_eligible: true/)
  assert.match(captureSource,/open_only:true|body\.open_only === true/)
  assert.match(captureSource,/query = query\.eq\('rep_user_id', user\.id\)/)
  assert.match(salesSource,/sb\.functions\.invoke\('sale-submit'/)
  assert.match(salesSource,/setSaleMsg\(\(error\?\.message\|\|'Sale could not be completed/)
})
