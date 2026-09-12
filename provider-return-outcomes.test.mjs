import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import vm from 'node:vm';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<8;i++)await tick();}

function browser({stored=null,failStart=false,submitHook=null,abandonHook=null,listHook=null}={}){
  const dom=new JSDOM('<button class="nav-btn" data-view="field">Sales Hub</button><main class="main"><section id="field"><input id="fieldLeadAddressInput"><select id="fieldLeadSelect"></select><div class="spotio-disposition-actions"><button data-disp="Sale" id="processSaleBtn">SALE</button></div><div class="spotio-disposition-panel"></div><div id="efficiencySummary"></div></section></main>',{url:'https://www.mccoyplatform.com/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,timers=[],intervals=[],calls=[],captures=new Map(),events=[],children=[];
  const model={sales:[],rankingRefreshes:0,doorCompletions:0,returns:0,failStart};
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
    calls.push({name,body:structuredClone(body||{})});
    if(name==='company-leaders')return{data:{ok:true,rankings:[]}};
    if(name==='sale-submit')return submitHook?submitHook(body,()=>saveSale(body.provider_capture_id)):saveSale(body.provider_capture_id);
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
  if(stored){captures.set(stored.id,{...stored});w.localStorage.setItem('mccoy_active_provider_sale_capture_v1',JSON.stringify(stored));}
  for(const event of ['mccoy-sale-saved','mccoy-provider-sale-abandoned'])w.addEventListener(event,e=>events.push({type:event,detail:e.detail}));
  for(const name of ['app-supabase-client.js','app-provider-portals.js','app-provider-sale-router.js','app-sales.js','app-sale-lifecycle.js','app-sale-visit-isolation.js'])vm.runInContext(read('./'+name),dom.getInternalVMContext());
  const screen=w.document.getElementById('providerReturnScreen');
  async function start(){w.document.getElementById('processSaleBtn').click();await settle();w.document.getElementById('providerRouterContinue').click();await settle();}
  async function back(){children.at(-1).closed=true;for(const interval of intervals)if(interval.active&&interval.delay===400)interval.fn();for(const timer of timers.splice(0))if(timer.delay===80)timer.fn();await settle();}
  return{w,dom,model,calls,captures,events,children,screen,timers,start,back,source,close:()=>w.close()};
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
