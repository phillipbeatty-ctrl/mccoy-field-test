import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import vm from 'node:vm';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<8;i++)await tick();}

function browser({stored=null,recovery={},failStart=false,submitHook=null,abandonHook=null,listHook=null,photos=false,photoHook=null,uploadHook=null}={}){
  const dom=new JSDOM('<button class="nav-btn" data-view="field">Sales Hub</button><main class="main"><section id="field"><input id="fieldLeadAddressInput"><select id="fieldLeadSelect"></select><div class="spotio-disposition-actions"><button data-disp="Sale" id="processSaleBtn">SALE</button></div><div class="spotio-disposition-panel"></div><div id="efficiencySummary"></div></section></main>',{url:'https://www.mccoyplatform.com/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,timers=[],intervals=[],calls=[],captures=new Map(),events=[],children=[];
  const model={sales:[],rankingRefreshes:0,doorCompletions:0,returns:0,failStart,photos:[],uploads:[]};
  w.MCCOY_ACCESS={user:{id:'actor',email:'rep@example.test'},access:{active:true,organization_id:'org',role:'rep'}};
  w.structuredClone=structuredClone;w.alert=()=>{};w.focus=()=>{};
  w.setTimeout=(fn,delay)=>{timers.push({fn,delay});return timers.length;};w.clearTimeout=()=>{};
  w.setInterval=(fn,delay)=>{intervals.push({fn,delay,active:true});return intervals.length;};w.clearInterval=id=>{if(intervals[id-1])intervals[id-1].active=false;};
  w.open=()=>{const child={closed:false,document:{open(){},write(){},close(){}},location:{replace(url){child.url=url;}},focus(){},close(){child.closed=true;}};children.push(child);return child;};
  const source={sale_context:'field',service_address:'100 Test St, Portland, OR 97201',lead_label:'100 Test St',lead_id:'lead-1',source_door_visit_id:'visit-1',session_id:'session-1',preserve_active_visit:false};
  w.state={leads:[{id:'lead-1',dbId:'lead-1',address:source.service_address}],realLeads:[],activeDoorVisit:{serverVisitId:'visit-1'},latestGps:null};
  w.telemetrySessionId='session-1';w.MCCOY_LEAD_ADDRESS_CORE={saleSource:()=>({...source})};w.MCCOY_LEAD_ADDRESS={focus(){}};
  w.MCCOY_REFRESH_RANKINGS=async()=>{model.rankingRefreshes++;};w.MCCOY_COMPLETE_DOOR_VISIT=async()=>{model.doorCompletions++;};
  w.document.querySelector('.nav-btn').addEventListener('click',()=>{model.returns++;});
  function saveSale(captureId){
    const capture=captures.get(captureId);if(!capture||capture.rep_user_id!==w.MCCOY_ACCESS.user.id)return{data:{ok:false,error:'provider_capture_not_found'}};
    if(capture.status==='cancelled')return{data:{ok:false,error:'provider_capture_abandoned'}};
    let sale=model.sales.find(s=>s.captureId===captureId);
    if(!sale){sale={id:'sale-'+(model.sales.length+1),captureId};model.sales.push(sale);}
    capture.status='recorded';capture.rep_outcome='completed';return{data:{ok:true,sale_id:sale.id}};
  }
  w.sb={auth:{getSession:async()=>({data:{session:{user:{id:w.MCCOY_ACCESS.user.id}}}})},functions:{invoke:async(name,{body}={})=>{
    calls.push({name,body:structuredClone(body||{}),actor:w.MCCOY_ACCESS.user.id,organization:w.MCCOY_ACCESS.access.organization_id});
    if(name==='company-leaders')return{data:{ok:true,rankings:[]}};
    if(name==='sale-submit')return submitHook?submitHook(body,()=>saveSale(body.provider_capture_id)):saveSale(body.provider_capture_id);
    if(name==='sale-order-photo')return{data:{ok:true}};
    if(name==='provider-sale-photo-stage'){
      const perform=()=>{
        if(body.action==='list')return{data:{ok:true,rows:model.photos.filter(p=>p.provider_capture_id===body.capture_id&&['uploading','staged','failed'].includes(p.status)).map(p=>({...p}))}};
        if(body.action==='create_upload'){
          const row={id:'photo-'+(model.photos.length+1),provider_capture_id:body.capture_id,status:'uploading'};model.photos.push(row);
          return{data:{ok:true,photo_id:row.id,path:'private/'+row.id,token:'synthetic-token'}};
        }
        if(body.action==='commit_upload'){
          const row=model.photos.find(p=>p.id===body.photo_id);row.status='staged';return{data:{ok:true,row:{...row}}};
        }
        if(body.action==='abort_upload'){
          const row=model.photos.find(p=>p.id===body.photo_id);if(row?.status==='uploading')row.status='deleted';return{data:{ok:true}};
        }
        if(body.action==='discard'){model.photos.filter(p=>p.provider_capture_id===body.capture_id&&p.status!=='attached').forEach(p=>p.status='deleted');return{data:{ok:true}};}
        if(body.action==='finalize'){
          const sale=model.sales.find(s=>s.id===body.sale_id&&s.captureId===body.capture_id);assert.ok(sale);
          const rows=model.photos.filter(p=>p.provider_capture_id===body.capture_id&&p.status==='staged');rows.forEach(p=>{p.status='attached';p.saleId=sale.id;});
          return{data:{ok:true,sale_photo_ids:rows.map(p=>p.id)}};
        }
        throw new Error('Unexpected photo action '+body.action);
      };
      return photoHook?photoHook(body,perform):perform();
    }
    assert.equal(name,'provider-sale-capture');
    if(body.action==='start'){
      if(model.failStart)return{data:{ok:false,error:'offline'}};
      let capture=[...captures.values()].find(c=>c.client_request_id===body.client_request_id);
      if(!capture){capture={...body,id:'capture-'+(captures.size+1),created_at:new Date().toISOString(),status:body.portal_opened?'dashboard_opened':'details_required',rep_user_id:w.MCCOY_ACCESS.user.id};captures.set(capture.id,capture);}
      return{data:{ok:true,capture:{...capture}}};
    }
    if(body.action==='list'){
      if(listHook){const result=await listHook(body,captures);if(result)return result;}
      return{data:{ok:true,captures:[...captures.values()].filter(c=>c.rep_user_id===w.MCCOY_ACCESS.user.id&&(!body.open_only||['dashboard_opened','details_required'].includes(c.status))).map(c=>({...c}))}};
    }
    if(body.action==='set_outcome'){
      const capture=captures.get(body.capture_id);
      const cancel=()=>{if(!capture||!['dashboard_opened','details_required'].includes(capture.status))return{data:{ok:false,error:'capture_not_open'}};capture.status='cancelled';capture.rep_outcome='abandoned';return{data:{ok:true,capture:{...capture}}};};
      return abandonHook?abandonHook(body,cancel):cancel();
    }
    throw new Error('Unexpected action '+body.action);
  }},from:()=>({select(){return this;},gte(){return this;},order(){return this;},limit:async()=>({data:[]})})};
  w.sb.storage={from:bucket=>({uploadToSignedUrl:async(path,token,file)=>{
    model.uploads.push({bucket,path,name:file.name});return uploadHook?uploadHook():{error:null};
  }})};
  if(stored){captures.set(stored.id,{...stored});w.localStorage.setItem('mccoy_active_provider_sale_capture_v1',JSON.stringify(stored));}
  for(const [key,value] of Object.entries(recovery))w.localStorage.setItem(key,typeof value==='string'?value:JSON.stringify(value));
  for(const event of ['mccoy-sale-saved','mccoy-provider-sale-abandoned'])w.addEventListener(event,e=>events.push({type:event,detail:e.detail}));
  for(const name of ['app-supabase-client.js','app-provider-portals.js','app-provider-sale-router.js','app-sales.js','app-sale-lifecycle.js','app-sale-visit-isolation.js'])vm.runInContext(read('./'+name),dom.getInternalVMContext());
  if(photos){
    w.addEventListener('mccoy-provider-sale-photo-staged',e=>events.push({type:e.type,detail:e.detail}));
    vm.runInContext(read('./app-sale-photo-staging.js'),dom.getInternalVMContext());
    w.dispatchEvent(new w.Event('mccoy-sales-hub-layout-ready'));
  }
  const screen=w.document.getElementById('providerReturnScreen');
  async function selectFile({name='order.png',type='image/png',empty=false,picker='stageSalePhotoBtn'}={}){
    if(picker)w.document.getElementById(picker).click();
    const input=w.document.getElementById('salePhotoStageInput');
    Object.defineProperty(input,'files',{configurable:true,value:empty?[]:[new w.File(['test image'],name,{type})]});
    input.dispatchEvent(new w.Event('change'));await settle();
  }
  async function start(){w.document.getElementById('processSaleBtn').click();await settle();w.document.getElementById('providerRouterContinue').click();await settle();}
  async function back(){children.at(-1).closed=true;for(const interval of intervals)if(interval.active&&interval.delay===400)interval.fn();for(const timer of timers.splice(0))if(timer.delay===80)timer.fn();await settle();}
  return{w,dom,model,calls,captures,events,children,screen,timers,start,back,source,selectFile,close:()=>w.close()};
}

test('provider return replaces the inline Sales Hub panel with two accessible icon choices',async()=>{
  const h=browser();try{
    assert.equal(h.w.document.getElementById('saleModal'),null);
    assert.equal(h.screen.parentElement,h.w.document.body);assert.equal(h.screen.hidden,true);
    await h.start();assert.equal(h.captures.size,1);assert.equal(h.screen.hidden,true);assert.match(h.children[0].url,/qfasap/);
    await h.back();assert.equal(h.screen.hidden,false);assert.equal(h.w.document.activeElement,h.screen);
    assert.equal(h.screen.querySelectorAll('.provider-return-actions button').length,2);
    for(const id of ['completeSaleBtn','abandonedSaleBtn']){const button=h.w.document.getElementById(id);assert.ok(button.querySelector('svg'));assert.match(button.getAttribute('aria-label'),/return to Field Coach/);}
    assert.equal(h.calls.filter(c=>c.body.action==='mark_returned').length,0);
    assert.equal(h.model.sales.length,0);assert.equal(h.captures.get('capture-1').status,'dashboard_opened');
  }finally{h.close();}
});

test('green check records one sale, closes the provider window and returns to Field Coach',async()=>{
  const h=browser();try{await h.start();await h.back();h.w.document.getElementById('completeSaleBtn').click();h.w.document.getElementById('completeSaleBtn').click();await settle();
    assert.equal(h.model.sales.length,1);assert.equal(h.calls.filter(c=>c.name==='sale-submit').length,1);assert.equal(h.screen.hidden,true);assert.equal(h.model.returns,1);assert.equal(h.model.rankingRefreshes,1);assert.equal(h.model.doorCompletions,1);assert.equal(h.events.filter(e=>e.type==='mccoy-sale-saved').length,1);assert.equal(h.children[0].closed,true);
    assert.equal(h.w.localStorage.getItem('mccoy_active_provider_sale_capture_v1'),null);
  }finally{h.close();}
});

test('red X records abandonment, returns, and never creates a sale or celebration',async()=>{
  const h=browser();try{await h.start();await h.back();h.w.document.getElementById('abandonedSaleBtn').click();await settle();
    assert.equal(h.captures.get('capture-1').status,'cancelled');assert.equal(h.model.sales.length,0);assert.equal(h.calls.filter(c=>c.name==='sale-submit').length,0);assert.equal(h.model.rankingRefreshes,0);assert.equal(h.model.doorCompletions,0);assert.equal(h.screen.hidden,true);assert.equal(h.model.returns,1);assert.equal(h.events.filter(e=>e.type==='mccoy-sale-saved').length,0);
  }finally{h.close();}
});

test('closing the browser or pressing Escape never implies an outcome',async()=>{
  const h=browser();try{await h.start();await h.back();h.screen.dispatchEvent(new h.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await settle();
    assert.equal(h.screen.hidden,false);assert.equal(h.model.sales.length,0);assert.equal(h.captures.get('capture-1').status,'dashboard_opened');assert.equal(h.calls.filter(c=>c.body.action==='set_outcome').length,0);
  }finally{h.close();}
});

test('a failed completion keeps the same return screen and capture available for green retry',async()=>{
  let tries=0;const h=browser({submitHook:(_body,save)=>++tries===1?{data:{ok:false,error:'network_failure'}}:save()});
  try{await h.start();await h.back();h.w.document.getElementById('completeSaleBtn').click();await settle();
    assert.equal(h.screen.hidden,false);assert.match(h.w.document.getElementById('saleMsg').textContent,/Retry the green check/);assert.equal(h.w.document.getElementById('abandonedSaleBtn').disabled,true);
    h.w.document.getElementById('completeSaleBtn').click();await settle();assert.equal(h.model.sales.length,1);assert.equal(h.model.returns,1);assert.equal(new Set(h.calls.filter(c=>c.name==='sale-submit').map(c=>c.body.provider_capture_id)).size,1);
  }finally{h.close();}
});

test('lost abandonment response is recovered without fabricating a sale',async()=>{
  let tries=0;const h=browser({abandonHook:(_body,cancel)=>{const result=cancel();if(++tries===1)throw new Error('response lost');return result;}});
  try{await h.start();await h.back();h.w.document.getElementById('abandonedSaleBtn').click();await settle();assert.equal(h.screen.hidden,false);
    h.w.document.getElementById('abandonedSaleBtn').click();await settle();assert.equal(h.screen.hidden,true);assert.equal(h.model.returns,1);assert.equal(h.model.sales.length,0);
  }finally{h.close();}
});

test('another SALE resumes the unfinished attempt instead of silently abandoning it',async()=>{
  const h=browser();try{await h.start();await h.back();h.w.document.getElementById('processSaleBtn').click();await settle();
    assert.equal(h.screen.hidden,false);assert.equal(h.calls.filter(c=>c.body.action==='start').length,1);assert.equal(h.captures.get('capture-1').status,'dashboard_opened');
    h.w.document.getElementById('providerReturnResume').click();await settle();assert.equal(h.screen.hidden,true);assert.equal(h.children.length,2);assert.equal(h.captures.size,1);
  }finally{h.close();}
});

test('capture failure keeps the provider closed and retry reuses its request identity',async()=>{
  const h=browser({failStart:true});try{await h.start();assert.equal(h.children[0].closed,true);assert.equal(h.children[0].url,undefined);assert.equal(h.captures.size,0);
    h.model.failStart=false;h.w.document.getElementById('providerRouterContinue').click();await settle();assert.equal(h.captures.size,1);assert.match(h.children.at(-1).url,/qfasap/);assert.equal(new Set(h.calls.filter(c=>c.body.action==='start').map(c=>c.body.client_request_id)).size,1);
  }finally{h.close();}
});

test('an account switch during a save cannot clear the new account or display its predecessor’s result',async()=>{
  let resolve;const h=browser({submitHook:()=>new Promise(r=>resolve=r)});
  try{await h.start();await h.back();h.w.document.getElementById('completeSaleBtn').click();await settle();
    h.w.MCCOY_ACCESS.user.id='other';h.w.dispatchEvent(new h.w.Event('mccoy-access-ready'));await settle();
    resolve({data:{ok:true,sale_id:'old-account-sale'}});await settle();assert.equal(h.screen.hidden,true);assert.equal(h.model.returns,0);assert.equal(h.events.length,0);
  }finally{h.close();}
});

test('return restoration is scoped to the signed-in user and background validation preserves focus',async()=>{
  const stored={id:'previous',client_request_id:'previous-request',provider:'Quantum',service_address:'Private previous address',rep_user_id:'other',actor_key:'other:org',status:'dashboard_opened',created_at:new Date().toISOString()};
  const h=browser({stored});try{
    await h.w.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE();assert.equal(h.screen.hidden,true);assert.equal(h.w.document.getElementById('providerReturnAddress').textContent,'');
    await h.start();await h.back();const red=h.w.document.getElementById('abandonedSaleBtn');red.focus();await h.w.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE();assert.equal(h.w.document.activeElement,red);
  }finally{h.close();}
});


test('a lost successful green response retries the same sale without duplicate credit',async()=>{
  let tries=0;const h=browser({submitHook:(_body,save)=>{const result=save();if(++tries===1)throw new Error('response lost');return result;}});
  try{await h.start();await h.back();h.w.document.getElementById('completeSaleBtn').click();await settle();assert.equal(h.screen.hidden,false);assert.equal(h.model.sales.length,1);
    h.w.document.getElementById('completeSaleBtn').click();await settle();assert.equal(h.model.sales.length,1);assert.equal(h.model.rankingRefreshes,1);assert.equal(h.model.returns,1);
  }finally{h.close();}
});

test('reload restores an owned unfinished attempt and preserves a previously selected retry outcome',async()=>{
  const stored={id:'restored',client_request_id:'restored-request',provider:'Quantum',service_address:'100 Test St',rep_user_id:'actor',actor_key:'actor:org',status:'dashboard_opened',outcome_pending:'completed',created_at:new Date().toISOString()};
  const h=browser({stored});try{await h.w.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE();assert.equal(h.screen.hidden,false);assert.equal(h.w.document.getElementById('abandonedSaleBtn').disabled,true);h.w.document.getElementById('completeSaleBtn').click();await settle();assert.equal(h.model.sales.length,1);assert.equal(h.model.doorCompletions,0);assert.equal(h.screen.hidden,true);
  }finally{h.close();}
});

test('an unlinked phone sale leaves another active physical door untouched',async()=>{
  const h=browser();try{h.source.sale_context='out_of_area_phone';h.source.source_door_visit_id=null;h.source.preserve_active_visit=true;await h.start();await h.back();h.w.document.getElementById('completeSaleBtn').click();await settle();assert.equal(h.model.sales.length,1);assert.equal(h.model.doorCompletions,0);assert.equal(h.w.state.activeDoorVisit.serverVisitId,'visit-1');
  }finally{h.close();}
});

test('canceling failed setup and pressing SALE again resumes the same unsaved attempt',async()=>{
  const h=browser({failStart:true});try{await h.start();h.w.document.getElementById('providerRouterCancel').click();h.model.failStart=false;await h.start();assert.equal(h.captures.size,1);assert.match(h.children.at(-1).url,/qfasap/);assert.equal(new Set(h.calls.filter(c=>c.body.action==='start').map(c=>c.body.client_request_id)).size,1);
  }finally{h.close();}
});

test('an account switch dismisses the previous user’s provider chooser',async()=>{
  const h=browser();try{h.w.document.getElementById('processSaleBtn').click();await settle();assert.equal(h.w.document.getElementById('providerSaleRouter').classList.contains('show'),true);h.w.MCCOY_ACCESS.user.id='other';h.w.dispatchEvent(new h.w.Event('mccoy-access-ready'));h.w.document.getElementById('providerRouterContinue').click();await settle();assert.equal(h.captures.size,0);assert.equal(h.w.document.getElementById('providerSaleRouter').classList.contains('show'),false);
  }finally{h.close();}
});


test('returning to an attempt resolved elsewhere never reopens or overwrites it',async()=>{
  const h=browser();try{await h.start();h.captures.get('capture-1').status='recorded';await h.back();assert.equal(h.screen.hidden,true);assert.equal(h.captures.get('capture-1').status,'recorded');assert.equal(h.calls.filter(c=>['mark_returned','set_outcome'].includes(c.body.action)).length,0);assert.equal(h.model.sales.length,0);
  }finally{h.close();}
});

test('committed screenshot opens sale choices for the captured address without choosing an outcome',async()=>{
  const h=browser({photos:true});try{
    await h.start();assert.equal(h.screen.hidden,true);
    await h.selectFile();
    assert.equal(h.screen.hidden,false);assert.equal(h.w.document.getElementById('providerReturnAddress').textContent,h.source.service_address);
    assert.equal(h.model.photos[0].status,'staged');assert.equal(h.model.uploads[0].bucket,'provider-sale-staged-photos');
    assert.equal(h.events.filter(e=>e.type==='mccoy-provider-sale-photo-staged').length,1);
    assert.equal(h.model.sales.length,0);assert.equal(h.captures.get('capture-1').status,'dashboard_opened');
    assert.equal(h.w.document.getElementById('completeSaleBtn').disabled,false);
  }finally{h.close();}
});

test('return screen can add a screenshot and green attaches it to exactly one sale',async()=>{
  const h=browser({photos:true});try{
    await h.start();await h.back();
    assert.equal(h.w.document.getElementById('providerReturnPhoto').disabled,false);
    await h.selectFile({picker:'providerReturnPhoto'});
    h.w.document.getElementById('completeSaleBtn').click();h.w.document.getElementById('completeSaleBtn').click();await settle();
    assert.equal(h.model.sales.length,1);assert.equal(h.model.photos[0].status,'attached');assert.equal(h.model.photos[0].saleId,h.model.sales[0].id);
    assert.equal(h.screen.hidden,true);assert.equal(h.model.rankingRefreshes,1);
  }finally{h.close();}
});

test('upload in progress disables both outcomes and resume until the server commits the image',async()=>{
  let release;const h=browser({photos:true,uploadHook:()=>new Promise(resolve=>release=resolve)});try{
    await h.start();await h.back();await h.selectFile({picker:'providerReturnPhoto'});
    for(const id of ['completeSaleBtn','abandonedSaleBtn','providerReturnResume','providerReturnPhoto'])assert.equal(h.w.document.getElementById(id).disabled,true,id);
    h.w.document.getElementById('completeSaleBtn').click();h.w.document.getElementById('abandonedSaleBtn').click();
    assert.equal(h.model.sales.length,0);assert.equal(h.events.filter(e=>e.type==='mccoy-provider-sale-photo-staged').length,0);
    release({error:null});await settle();
    assert.equal(h.w.document.getElementById('completeSaleBtn').disabled,false);assert.equal(h.model.photos[0].status,'staged');
  }finally{h.close();}
});

for(const failure of ['empty','invalid','upload','commit'])test(`${failure} screenshot selection does not open choices or record a sale`,async()=>{
  const h=browser({photos:true,uploadHook:failure==='upload'?async()=>({error:new Error('Upload unavailable')}):null,photoHook:failure==='commit'?(body,perform)=>body.action==='commit_upload'?{data:{ok:false,error:'Commit unavailable'}}:perform():null});
  try{
    await h.start();await h.selectFile(failure==='empty'?{empty:true}:failure==='invalid'?{name:'order.pdf',type:'application/pdf'}:{});
    assert.equal(h.screen.hidden,true);assert.equal(h.model.sales.length,0);assert.equal(h.events.filter(e=>e.type==='mccoy-provider-sale-photo-staged').length,0);
    assert.equal(h.w.MCCOY_SALE_PHOTO_STATE().busy,false);
    if(failure==='empty'||failure==='invalid')assert.equal(h.model.uploads.length,0);
    await h.back();assert.equal(h.w.document.getElementById('abandonedSaleBtn').disabled,false);
  }finally{h.close();}
});

test('red after a staged screenshot discards its evidence and creates no sale',async()=>{
  const h=browser({photos:true});try{
    await h.start();await h.selectFile();h.w.document.getElementById('abandonedSaleBtn').click();await settle();
    assert.equal(h.screen.hidden,true);assert.equal(h.model.sales.length,0);assert.equal(h.model.photos[0].status,'deleted');
  }finally{h.close();}
});

test('account change while the photo picker is open does not upload the old selection',async()=>{
  const h=browser({photos:true});try{
    await h.start();h.w.document.getElementById('stageSalePhotoBtn').click();
    h.w.MCCOY_ACCESS.user.id='other';h.w.dispatchEvent(new h.w.Event('mccoy-access-ready'));
    await h.selectFile({picker:null});assert.equal(h.model.uploads.length,0);assert.equal(h.screen.hidden,true);
  }finally{h.close();}
});

test('late upload completion after an organization switch cannot commit or reopen the old sale',async()=>{
  let release;const h=browser({photos:true,uploadHook:()=>new Promise(resolve=>release=resolve),listHook:()=>h.w.MCCOY_ACCESS.access.organization_id==='other-org'?{data:{ok:true,captures:[]}}:null});try{
    await h.start();await h.selectFile();h.w.MCCOY_ACCESS.access.organization_id='other-org';h.w.dispatchEvent(new h.w.Event('mccoy-access-ready'));await settle();
    release({error:null});await settle();assert.equal(h.screen.hidden,true);assert.equal(h.events.filter(e=>e.type==='mccoy-provider-sale-photo-staged').length,0);
    assert.equal(h.calls.filter(c=>c.name==='provider-sale-photo-stage'&&c.body.action==='commit_upload').length,0);
    assert.equal(h.w.MCCOY_SALE_PHOTO_STATE().capture,null);
  }finally{h.close();}
});

test('server-validated same-owner reload can explicitly attach its screenshot',async()=>{
  const stored={id:'restored',client_request_id:'restored-request',provider:'Quantum',service_address:'100 Test St',rep_user_id:'actor',actor_key:'actor:org',status:'dashboard_opened',created_at:new Date().toISOString()};
  const h=browser({photos:true,stored});try{
    assert.equal(h.w.document.getElementById('providerReturnPhoto').disabled,true);
    await h.w.MCCOY_VALIDATE_ACTIVE_PROVIDER_CAPTURE();await settle();
    await h.selectFile({picker:'providerReturnPhoto'});
    assert.equal(h.model.photos[0].provider_capture_id,'restored');assert.equal(h.model.sales.length,0);assert.equal(h.screen.hidden,false);
  }finally{h.close();}
});

test('late photo list cannot erase a newly committed screenshot or overwrite its success status',async()=>{
  let release;let first=true;const h=browser({photos:true,photoHook:(body,perform)=>{
    if(body.action==='list'&&first){first=false;return new Promise(resolve=>release=resolve);}return perform();
  }});try{
    await h.start();await h.selectFile();release({data:{ok:true,rows:[]}});await settle();
    assert.equal(h.w.MCCOY_SALE_PHOTO_STATE().count,1);assert.match(h.w.document.getElementById('providerReturnPhotoStatus').textContent,/1 photo staged/);
  }finally{h.close();}
});

test('a screenshot arriving after the user chose an outcome cannot reopen its choices',async()=>{
  let release;const h=browser({photos:true,submitHook:()=>new Promise(resolve=>release=resolve)});try{
    await h.start();await h.back();const capture={...h.w.MCCOY_ACTIVE_PROVIDER_CAPTURE};h.w.document.getElementById('completeSaleBtn').click();await settle();
    h.w.dispatchEvent(new h.w.CustomEvent('mccoy-provider-sale-photo-staged',{detail:{capture,photoId:'late-photo'}}));
    assert.match(h.w.document.getElementById('saleMsg').textContent,/Saving sale/);assert.equal(h.w.document.getElementById('providerReturnPhoto').disabled,true);
    release({data:{ok:false,error:'retry'}});await settle();assert.equal(h.w.document.getElementById('abandonedSaleBtn').disabled,true);
  }finally{h.close();}
});

test('a changed capture during upload cannot receive the previous address screenshot',async()=>{
  let release;const h=browser({photos:true,uploadHook:()=>new Promise(resolve=>release=resolve)});try{
    await h.start();await h.selectFile();
    const next={...h.w.MCCOY_ACTIVE_PROVIDER_CAPTURE,id:'next-capture',client_request_id:'next-request',service_address:'200 Next St'};
    h.w.MCCOY_ACTIVE_PROVIDER_CAPTURE=next;
    h.w.dispatchEvent(new h.w.CustomEvent('mccoy-provider-sale-capture-started',{detail:{capture:next}}));
    h.w.dispatchEvent(new h.w.CustomEvent('mccoy-provider-sale-capture-ready',{detail:{capture:next,validated:true}}));
    release({error:null});await settle();
    assert.equal(h.events.filter(e=>e.type==='mccoy-provider-sale-photo-staged').length,0);
    assert.equal(h.calls.filter(c=>c.name==='provider-sale-photo-stage'&&c.body.action==='commit_upload').length,0);
    assert.equal(h.w.MCCOY_SALE_PHOTO_STATE().capture.id,'next-capture');assert.equal(h.w.MCCOY_SALE_PHOTO_STATE().count,0);
  }finally{h.close();}
});

test('lost upload confirmation does not choose a sale and manual green still attaches committed evidence',async()=>{
  const h=browser({photos:true,photoHook:(body,perform)=>{const result=perform();if(body.action==='commit_upload')throw new Error('Confirmation lost');return result;}});try{
    await h.start();await h.selectFile();
    assert.equal(h.screen.hidden,true);assert.equal(h.model.photos[0].status,'staged');assert.equal(h.model.sales.length,0);
    await h.back();h.w.document.getElementById('completeSaleBtn').click();await settle();
    assert.equal(h.model.sales.length,1);assert.equal(h.model.photos[0].status,'attached');
  }finally{h.close();}
});

test('failed photo attachment can retry without submitting the sale again',async()=>{
  let tries=0;const h=browser({photos:true,photoHook:(body,perform)=>body.action==='finalize'&&++tries===1?{data:{ok:false,error:'Attachment unavailable'}}:perform()});try{
    await h.start();await h.selectFile();h.w.document.getElementById('completeSaleBtn').click();await settle();
    assert.equal(h.model.sales.length,1);assert.equal(h.model.photos[0].status,'staged');assert.match(h.w.document.getElementById('salePhotoStageStatus').textContent,/attachment is pending/);
    h.w.document.getElementById('salePhotoStageStatus').querySelector('button').click();await settle();
    assert.equal(h.model.photos[0].status,'attached');assert.equal(h.calls.filter(c=>c.name==='sale-submit').length,1);
  }finally{h.close();}
});

const isRecoveryKey=key=>key.startsWith('mccoy_sale_photo_recovery_v2:')||key==='mccoy_pending_sale_photo_finalize_v1';
const recoveryRecords=h=>Object.keys(h.w.localStorage).filter(isRecoveryKey).map(key=>JSON.parse(h.w.localStorage.getItem(key)));
const retryPhotos=async h=>{const button=h.w.document.querySelector('#salePhotoStageStatus button');assert.ok(button,'pending photo action must have a retry control');assert.match(button.textContent,/RETRY PHOTOS/);button.click();await settle();};

test('failed abandonment cleanup stays pending, survives the next attempt and retries only its own photos',async()=>{
  let fail=true;const h=browser({photos:true,photoHook:(body,perform)=>body.action==='discard'&&fail?{data:{ok:false,error:'Storage offline'}}:perform()});try{
    await h.start();await h.selectFile();h.w.document.getElementById('abandonedSaleBtn').click();await settle();
    assert.match(h.w.document.getElementById('salePhotoStageStatus').textContent,/cleanup (?:is )?pending/i);
    assert.doesNotMatch(h.w.document.getElementById('salePhotoStageStatus').textContent,/were deleted|photos deleted/i);
    assert.equal(recoveryRecords(h).length,1);
    await h.start();await h.selectFile();fail=false;await retryPhotos(h);
    assert.equal(h.model.photos[0].status,'deleted');assert.equal(h.model.photos[1].status,'staged');
    assert.equal(h.w.MCCOY_SALE_PHOTO_STATE().capture.id,'capture-2');assert.equal(h.w.MCCOY_SALE_PHOTO_STATE().count,1);assert.equal(h.model.sales.length,0);assert.equal(recoveryRecords(h).length,0);
  }finally{h.close();}
});

test('multiple failed sale attachments retain independent records and retry without resubmitting either sale',async()=>{
  let fail=true;const h=browser({photos:true,photoHook:(body,perform)=>body.action==='finalize'&&fail?{data:{ok:false,error:'Storage offline'}}:perform()});try{
    for(let i=0;i<2;i++){await h.start();await h.selectFile();h.w.document.getElementById('completeSaleBtn').click();await settle();}
    assert.equal(recoveryRecords(h).length,2);assert.equal(h.model.sales.length,2);
    fail=false;await retryPhotos(h);
    assert.deepEqual(h.model.photos.map(p=>p.saleId),['sale-1','sale-2']);assert.equal(recoveryRecords(h).length,0);
    assert.equal(h.calls.filter(c=>c.name==='sale-submit').length,2);
  }finally{h.close();}
});

for(const action of ['finalize','discard'])test(`late ${action} response leaves the newer attempt and its photo intact`,async()=>{
  let release;const h=browser({photos:true,photoHook:(body,perform)=>body.action===action?new Promise(resolve=>release=()=>resolve(perform())):perform()});try{
    await h.start();await h.selectFile();h.w.document.getElementById(action==='finalize'?'completeSaleBtn':'abandonedSaleBtn').click();await settle();
    await h.start();await h.selectFile();const next=h.w.MCCOY_SALE_PHOTO_STATE();assert.equal(next.capture.id,'capture-2');
    release();await settle();assert.equal(h.w.MCCOY_SALE_PHOTO_STATE().capture.id,next.capture.id);assert.equal(h.w.MCCOY_SALE_PHOTO_STATE().count,1);assert.equal(h.model.photos[1].status,'staged');
  }finally{h.close();}
});

test('legacy attachment recovery is never sent by a different signed-in account',async()=>{
  const pending={saleId:'sale-old',providerCaptureId:'capture-old',actor_key:'previous:org'};
  const h=browser({photos:true,recovery:{mccoy_pending_sale_photo_finalize_v1:pending}});try{
    h.w.dispatchEvent(new h.w.Event('mccoy-access-ready'));await settle();
    assert.equal(h.calls.filter(c=>c.name==='provider-sale-photo-stage'&&c.body.action==='finalize').length,0);
    assert.ok(h.w.localStorage.getItem('mccoy_pending_sale_photo_finalize_v1'));
  }finally{h.close();}
});

test('legacy record without account ownership is retained without an automatic attachment request',async()=>{
  const h=browser({photos:true,recovery:{mccoy_pending_sale_photo_finalize_v1:{saleId:'unknown-sale',providerCaptureId:'unknown-capture'}}});try{
    h.w.dispatchEvent(new h.w.Event('mccoy-access-ready'));await settle();
    assert.equal(h.calls.filter(c=>c.name==='provider-sale-photo-stage'&&c.body.action==='finalize').length,0);
    assert.ok(h.w.localStorage.getItem('mccoy_pending_sale_photo_finalize_v1'));
  }finally{h.close();}
});

test('pending recovery stays with the original account across switching away and back',async()=>{
  let fail=true;const h=browser({photos:true,photoHook:(body,perform)=>body.action==='finalize'&&fail?{data:{ok:false,error:'Offline'}}:perform()});try{
    await h.start();await h.selectFile();h.w.document.getElementById('completeSaleBtn').click();await settle();
    h.w.MCCOY_ACCESS.user.id='other';h.w.dispatchEvent(new h.w.Event('mccoy-access-ready'));await settle();
    assert.equal(h.calls.filter(c=>c.name==='provider-sale-photo-stage'&&c.body.action==='finalize'&&c.actor==='other').length,0);
    assert.equal(recoveryRecords(h).length,1);
    fail=false;h.w.MCCOY_ACCESS.user.id='actor';h.w.dispatchEvent(new h.w.Event('mccoy-access-ready'));await settle();
    assert.equal(h.model.photos[0].status,'attached');assert.equal(recoveryRecords(h).length,0);
  }finally{h.close();}
});

test('duplicate sale-saved events and retry taps coalesce one attachment request',async()=>{
  let release;const h=browser({photos:true,photoHook:(body,perform)=>body.action==='finalize'?new Promise(resolve=>release=()=>resolve(perform())):perform()});try{
    await h.start();await h.selectFile();h.w.document.getElementById('completeSaleBtn').click();await settle();
    const detail=h.events.find(e=>e.type==='mccoy-sale-saved').detail;
    for(let i=0;i<3;i++)h.w.dispatchEvent(new h.w.CustomEvent('mccoy-sale-saved',{detail}));
    h.w.dispatchEvent(new h.w.Event('mccoy-access-ready'));await settle();
    assert.equal(h.calls.filter(c=>c.name==='provider-sale-photo-stage'&&c.body.action==='finalize').length,1);
    release();await settle();assert.equal(h.model.photos[0].status,'attached');assert.equal(recoveryRecords(h).length,0);
  }finally{h.close();}
});

test('expired session leaves photo recovery queued without sending an unauthenticated attachment',async()=>{
  const h=browser({photos:true,submitHook:(_body,save)=>{const result=save();h.w.sb.auth.getSession=async()=>({data:{session:null}});return result;}});try{
    await h.start();await h.selectFile();
    h.w.document.getElementById('completeSaleBtn').click();await settle();
    assert.equal(h.calls.filter(c=>c.name==='provider-sale-photo-stage'&&c.body.action==='finalize').length,0);
    assert.equal(recoveryRecords(h).length,1);assert.match(h.w.document.getElementById('salePhotoStageStatus').textContent,/sign in/i);
  }finally{h.close();}
});

test('account-scoped legacy recovery migrates and attaches after an acknowledged sale',async()=>{
  const pending={saleId:'sale-legacy',providerCaptureId:'capture-legacy',actor_key:'actor:org'};
  const h=browser({photos:true,recovery:{mccoy_pending_sale_photo_finalize_v1:pending}});try{
    h.model.sales.push({id:'sale-legacy',captureId:'capture-legacy'});h.model.photos.push({id:'legacy-photo',provider_capture_id:'capture-legacy',status:'staged'});
    h.w.dispatchEvent(new h.w.Event('mccoy-access-ready'));await settle();
    assert.equal(h.model.photos[0].saleId,'sale-legacy');assert.equal(h.w.localStorage.getItem('mccoy_pending_sale_photo_finalize_v1'),null);assert.equal(recoveryRecords(h).length,0);assert.equal(h.calls.filter(c=>c.name==='sale-submit').length,0);
  }finally{h.close();}
});

test('storage quota failure keeps in-memory recovery and warns before the page can be lost',async()=>{
  let fail=true;const h=browser({photos:true,photoHook:(body,perform)=>body.action==='finalize'&&fail?{data:{ok:false,error:'Offline'}}:perform()});try{
    await h.start();await h.selectFile();const storagePrototype=Object.getPrototypeOf(h.w.localStorage),original=storagePrototype.setItem;
    storagePrototype.setItem=function(key,value){if(isRecoveryKey(key))throw new Error('QuotaExceededError');return original.call(this,key,value);};
    h.w.document.getElementById('completeSaleBtn').click();await settle();
    assert.equal(h.model.sales.length,1);assert.match(h.w.document.getElementById('salePhotoStageStatus').textContent,/Keep this page open and retry/);
    fail=false;await retryPhotos(h);assert.equal(h.model.photos[0].status,'attached');assert.equal(h.calls.filter(c=>c.name==='sale-submit').length,1);
  }finally{h.close();}
});

test('reload recovers separate photo records without creating a new sale or attempt',async()=>{
  const first=browser({photos:true,photoHook:(body,perform)=>body.action==='finalize'?{data:{ok:false,error:'Offline'}}:perform()});let restored;
  try{
    await first.start();await first.selectFile();first.w.document.getElementById('completeSaleBtn').click();await settle();
    const recovery=Object.fromEntries(Object.keys(first.w.localStorage).filter(isRecoveryKey).map(key=>[key,first.w.localStorage.getItem(key)]));
    restored=browser({photos:true,recovery});restored.model.sales.push(...structuredClone(first.model.sales));restored.model.photos.push(...structuredClone(first.model.photos));
    restored.w.dispatchEvent(new restored.w.Event('mccoy-access-ready'));await settle();
    assert.equal(restored.model.photos[0].status,'attached');assert.equal(restored.model.photos[0].saleId,'sale-1');assert.equal(restored.captures.size,0);assert.equal(restored.calls.filter(c=>c.name==='sale-submit').length,0);assert.equal(recoveryRecords(restored).length,0);
  }finally{first.close();restored?.close();}
});

test('PHOTO cannot upload a selection before an owned provider attempt exists',async()=>{
  const h=browser({photos:true});try{
    await h.selectFile();assert.equal(h.model.uploads.length,0);assert.equal(h.captures.size,0);assert.equal(h.model.sales.length,0);
    assert.equal(h.calls.filter(c=>c.name==='provider-sale-photo-stage').length,0);
  }finally{h.close();}
});
