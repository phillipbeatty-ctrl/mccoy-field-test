import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import vm from 'node:vm';
const source=readFileSync(new URL('./app-gps-placement.js',import.meta.url),'utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const address={address1:'100 Test St',address2:'',city:'Portland',state:'OR',zip:'97201'};
function harness({enabled=true,consent=true,production=false,productionEnabled=false,role='admin',handler=null}={}){
  const dom=new JSDOM('<div class="field-lead-combobox"><div><input id="fieldLeadAddressInput"><button id="addFieldAddressBtn">ADD ADDRESS</button></div><div id="fieldLeadAddressStatus"></div></div>',{
    runScripts:'outside-only',pretendToBeVisual:true,url:production?'https://www.mccoyplatform.com/':'http://localhost:3000/'});
  const w=dom.window,calls=[],positions=[],intervals=[];
  w.MCCOY_ACCESS={user:{id:'actor'},access:{organization_id:'org',active:true,role}};
  w.mccoyConsentAccepted=consent;w.state={realLeads:[]};
  w.setInterval=(...args)=>{intervals.push(args);return 1;};
  Object.defineProperty(w.navigator,'geolocation',{value:{getCurrentPosition:(ok,fail,options)=>positions.push({ok,fail,options})}});
  w.sb={functions:{invoke:async(name,{body})=>{
    calls.push({name,...body});
    if(body.action==='status')return{data:{ok:true,enabled,production_enabled:productionEnabled,can_manage:!productionEnabled,consented:consent}};
    if(handler)return handler(body);
    if(body.action==='set_pilot')return{data:{ok:true,enabled:body.input.enabled,production_enabled:productionEnabled,can_manage:!productionEnabled,consented:consent}};
    return{data:{ok:true,source:'user_reported_door',moved_count:2,accuracy_meters:200,low_accuracy:true,requires_door_selection:true,lead:null}};
  }}};
  vm.runInContext(source,dom.getInternalVMContext());
  const fix=(accuracy=200,timestamp=Date.now())=>positions.at(-1).ok({timestamp,coords:{latitude:45.5,longitude:-122.6,accuracy}});
  return{w,dom,calls,positions,intervals,fix,api:w.MCCOY_GPS_PLACEMENT,close:()=>w.close()};
}
test('production stays disabled when the server has not enabled the organization',async()=>{
  const h=harness({production:true,enabled:false});try{
    assert.equal(await h.api.knockDoor({visitId:"visit-a",address}),null);assert.equal(h.calls.filter(c=>c.action!=='status').length,0);assert.equal(h.positions.length,0);assert.equal(h.intervals.length,0);
  }finally{h.close();}
});
test('disabled pilot retains legacy address behavior without prompting for GPS',async()=>{
  const h=harness({enabled:false});try{assert.equal(await h.api.knockDoor({visitId:"visit-a",address}),null);assert.equal(h.positions.length,0);}finally{h.close();}
});
test('poor GPS places the group, retains the browser capture time and does not choose a duplicate',async()=>{
  const h=harness();try{
    const p=h.api.knockDoor({visitId:"visit-a",address});await turn();const captured=Date.now()-1000;h.fix(200,captured);const result=await p;
    const call=h.calls.find(c=>c.action==='knock_door');assert.equal(call.input.gps.captured_at,new Date(captured).toISOString());
    assert.equal(call.input.gps.accuracy_meters,200);assert.equal(call.input.address.address1,address.address1);assert.ok(call.input.request_id);
    assert.match(h.api.placementMessage(result),/2 pins placed/);assert.match(h.api.placementMessage(result),/Low accuracy/);assert.match(h.api.placementMessage(result),/stacked pins/);
    assert.equal(result.lead,null);assert.equal(h.positions[0].options.maximumAge,0);assert.equal(h.intervals.length,0);
  }finally{h.close();}
});
test('late GPS cannot submit a changed address or changed account',async()=>{
  for(const accountChange of [false,true]){
    const h=harness();try{let current=true;const p=h.api.knockDoor({visitId:"visit-a",address,isCurrent:()=>current});await turn();
      if(accountChange)h.w.MCCOY_ACCESS.user.id='other';else current=false;
      h.fix();assert.equal(await p,null);assert.equal(h.calls.filter(c=>c.action==='knock_door').length,0);
    }finally{h.close();}
  }
});
test('denied consent and invalid or expired GPS leave the address unchanged',async()=>{
  const no=harness({consent:false});try{await assert.rejects(no.api.knockDoor({visitId:"visit-a",address}),/location notice/);assert.equal(no.positions.length,0);}finally{no.close();}
  for(const accuracy of [-1,null,NaN]){
    const h=harness();try{const p=h.api.knockDoor({visitId:"visit-a",address});await turn();h.fix(accuracy);await assert.rejects(p,/current GPS/);assert.equal(h.calls.filter(c=>c.action==='knock_door').length,0);}finally{h.close();}
  }
  const h=harness();try{const p=h.api.knockDoor({visitId:"visit-a",address});await turn();h.fix(10,Date.now()-60000);await assert.rejects(p,/current GPS/);}finally{h.close();}
});
test('a lost response retries the same immutable request without moving twice',async()=>{
  let tries=0;const h=harness({handler:()=>++tries===1?{error:new Error('offline')}:{data:{ok:true,replayed:true}}});
  try{const p=h.api.knockDoor({visitId:"visit-a",address});await turn();h.fix();await assert.rejects(p,/retry/);
    assert.equal((await h.api.knockDoor({visitId:"visit-a",address})).replayed,true);
    const calls=h.calls.filter(c=>c.action==='knock_door');assert.equal(JSON.stringify(calls[0].input),JSON.stringify(calls[1].input));assert.equal(h.positions.length,1);
  }finally{h.close();}
});
test('a definite stale-location rejection asks for a fresh reading on the next press',async()=>{
  let tries=0;const h=harness({handler:()=>++tries===1?{data:{ok:false,error:'stale_location'}}:{data:{ok:true}}});
  try{const p=h.api.knockDoor({visitId:"visit-a",address});await turn();h.fix();await assert.rejects(p,/pin changed/);
    const retry=h.api.knockDoor({visitId:"visit-a",address});await turn();h.fix();await retry;
    const calls=h.calls.filter(c=>c.action==='knock_door');assert.notEqual(calls[0].input.request_id,calls[1].input.request_id);assert.equal(h.positions.length,2);
  }finally{h.close();}
});
test('status and layout events retain first-tap focus, selection, draft and one address input',async()=>{
  const h=harness();try{
    const input=h.w.document.getElementById('fieldLeadAddressInput');input.focus();input.value='100 unfinished';input.setSelectionRange(4,8);
    await turn();await h.api.refreshStatus();
    for(let i=0;i<3;i++)h.w.dispatchEvent(new h.w.Event('mccoy-sales-hub-layout-ready'));
    assert.equal(h.w.document.activeElement,input);assert.equal(input.selectionStart,4);assert.equal(input.selectionEnd,8);assert.equal(input.value,'100 unfinished');
    assert.equal(h.w.document.querySelectorAll('input').length,1);assert.equal(h.w.document.querySelectorAll('#gpsPlacementPilotNotice').length,1);
    assert.equal(h.w.document.querySelector('#gpsPlacementPilotNotice').parentElement,input.closest('.field-lead-combobox'));
  }finally{h.close();}
});
test('ADD ADDRESS never prompts for GPS and disposition hooks are absent',async()=>{
  const h=harness({consent:false});try{
    await h.api.addAddress({address});assert.equal(h.positions.length,0);
    assert.equal(h.calls.filter(c=>c.action==='add_address').length,1);
    assert.equal(h.api.captureForDisposition,undefined);assert.equal(h.api.dispositionSaved,undefined);
  }finally{h.close();}
});
test('late GPS responses cannot apply to a changed account or edited address',async()=>{
  let resolve;const h=harness({handler:()=>new Promise(r=>resolve=r)});
  try{
    let current=true;const p=h.api.knockDoor({visitId:'v',address,isCurrent:()=>current});await turn();h.fix();await turn();
    current=false;resolve({data:{ok:true,source:'user_reported_door'}});assert.equal(await p,null);
  }finally{h.close();}
});
test('an older lead-list response cannot undo placement and newer pin edits remain',()=>{
  const h=harness();try{
    h.w.state.realLeads=[{dbId:'a',lat:40,updatedAt:'2026-01-01T00:00:00Z'},{dbId:'b',lat:49,updatedAt:'2026-03-01T00:00:00Z'}];
    h.api.applyPlacement({source:'user_reported_door',lead_ids:['a','b'],pin_version:'2026-02-01T00:00:00Z',latitude:46,longitude:-123,low_accuracy:true});
    assert.equal(h.w.state.realLeads[0].lat,46);assert.equal(h.w.state.realLeads[0].updatedAt,'2026-02-01T00:00:00Z');
    assert.equal(h.w.state.realLeads[1].lat,49);assert.equal(h.w.state.realLeads[1].updatedAt,'2026-03-01T00:00:00Z');
  }finally{h.close();}
});
test('a sub-millisecond newer pin edit is not overwritten and duplicate updates emit no event',()=>{
  const h=harness();try{
    h.w.state.realLeads=[{dbId:'a',lat:49,updatedAt:'2026-02-01T00:00:00.123457+00:00'}];
    let events=0;h.w.addEventListener('mccoy-leads-updated',()=>events++);
    const data={source:'user_reported_door',lead_ids:['a'],pin_version:'2026-02-01T00:00:00.123456Z',latitude:46,longitude:-123};
    h.api.applyPlacement(data);assert.equal(h.w.state.realLeads[0].lat,49);assert.equal(events,0);
    data.pin_version='2026-02-01T00:00:00.123458Z';h.api.applyPlacement(data);h.api.applyPlacement(data);
    assert.equal(h.w.state.realLeads[0].lat,46);assert.equal(events,1);
  }finally{h.close();}
});

function doorHarness({startHandler=null,...options}={}){
  const h=harness(options),w=h.w,rpcs=[];
  w.document.body.insertAdjacentHTML('beforeend','<div class="door-visit-panel"><button id="arriveDoorBtn">KNOCK DOOR</button>'+readFileSync(new URL('./index.html',import.meta.url),'utf8').match(/<div id="doorVisitStatus"[^>]*>[^<]*<\/div>/)[0]+'<div class="door-timer"><div id="doorElapsed"></div></div><p class="muted" id="hiddenCoachingNote">Coaching diagnostics</p></div><button id="savePinDispositionBtn"></button>');
  Object.assign(w.state,{session:{startedAt:Date.now()},activities:[],breadcrumbs:[],leads:[]});
  const lead={id:'a',dbId:'a',address:'100 Test St',fullAddress:'100 Test St, Portland, OR 97201'};
  w.state.leads=[lead];w.state.realLeads=[lead];w.telemetrySessionId='session';
  let revision=0;
  w.MCCOY_LEAD_ADDRESS={current:()=>({kind:'assigned',valid:true,address:lead.fullAddress,lead}),revision:()=>revision};
  vm.runInContext(readFileSync(new URL('./app-lead-address-core.js',import.meta.url),'utf8'),h.dom.getInternalVMContext());
  w.snapshotGpsInstant=()=>null;w.saveTestEvent=()=>{};w.alert=()=>{};
  w.renderDashboard=w.renderTeams=w.renderLeads=()=>{};
  vm.runInContext(readFileSync(new URL('./app-door-workflow-core.js',import.meta.url),'utf8'),h.dom.getInternalVMContext());
  w.sb.rpc=async(name,params)=>{
    rpcs.push({name,params});
    if(startHandler&&name==='record_door_visit_start')return startHandler();
    return{data:{ok:true,visit_id:'visit-a',started_at:new Date().toISOString(),activity_type:'Visit',visit_result:'No Answer'}};
  };
  vm.runInContext(readFileSync(new URL('./app-part2.js',import.meta.url),'utf8'),h.dom.getInternalVMContext());
  return{...h,rpcs,edit:()=>revision++,button:w.document.getElementById('arriveDoorBtn'),status:w.document.getElementById('doorVisitStatus')};
}
test('one KNOCK DOOR click starts a visit then submits its GPS; repeated taps do not duplicate it',async()=>{
  const h=doorHarness();try{
    h.button.click();await turn();assert.equal(h.rpcs[0].name,'record_door_visit_start');
    assert.equal(h.positions.length,1);assert.equal(h.button.disabled,true);h.button.click();assert.equal(h.rpcs.length,1);
    h.fix();await turn();assert.equal(h.calls.filter(c=>c.action==='knock_door').length,1);
    assert.equal(h.calls.find(c=>c.action==='knock_door').input.visit_id,'visit-a');
    assert.equal(h.w.state.activeDoorVisit.gpsKnockPending,false);assert.equal(h.button.disabled,false);
    h.button.click();await turn();assert.equal(h.positions.length,1);assert.equal(h.rpcs.length,1);
    assert.match(h.status.textContent,/Door visit started.*2 pins placed/);
  }finally{h.close();}
});
test('GPS rejection retains the saved visit and KNOCK DOOR retries only its GPS',async()=>{
  const h=doorHarness();try{
    const p=h.w.MCCOY_START_DOOR_VISIT();await turn();h.positions[0].fail({code:1});assert.equal(await p,true);
    assert.equal(h.w.state.activeDoorVisit.serverVisitId,'visit-a');assert.match(h.status.textContent,/Door visit started.*permission was denied/);
    const retry=h.w.MCCOY_START_DOOR_VISIT();await turn();h.fix();assert.equal(await retry,true);
    assert.equal(h.rpcs.length,1);assert.equal(h.calls.filter(c=>c.action==='knock_door').length,1);
  }finally{h.close();}
});
test('an unsaved visit, automatic start, or changed address never submits pin GPS',async()=>{
  const failed=doorHarness({startHandler:()=>({data:{ok:false,reason:'session_expired'}})});
  try{assert.equal(await failed.w.MCCOY_START_DOOR_VISIT(),false);assert.equal(failed.positions.length,0);}finally{failed.close();}
  const automatic=doorHarness();try{assert.equal(await automatic.w.MCCOY_START_DOOR_VISIT({automatic:true}),true);assert.equal(automatic.positions.length,0);}finally{automatic.close();}
  const changed=doorHarness();try{
    const p=changed.w.MCCOY_START_DOOR_VISIT();await turn();changed.edit();changed.fix();assert.equal(await p,true);
    assert.equal(changed.calls.filter(c=>c.action==='knock_door').length,0);
  }finally{changed.close();}
});
test('saving the disposition after a knock does not acquire or submit another pin location',async()=>{
  const h=doorHarness();try{
    const p=h.w.MCCOY_START_DOOR_VISIT();await turn();h.fix();await p;
    const positions=h.positions.length,calls=h.calls.length;
    assert.equal(await h.w.MCCOY_COMPLETE_DOOR_VISIT('spotio',{activityType:'Visit',visitResult:'No Answer'}),true);
    assert.equal(h.positions.length,positions);assert.equal(h.calls.length,calls);assert.equal(h.w.state.activeDoorVisit,null);
    assert.equal(h.rpcs.at(-1).name,'record_spotio_door_visit_completion');
  }finally{h.close();}
});
test('a newly placed exact typed door stays linked to its visit and immediate sale',async()=>{
  const h=doorHarness({handler:()=>({data:{ok:true,created:true,source:'user_reported_door',lead:{id:'new-door'},lead_ids:['new-door'],moved_count:1,latitude:45.5,longitude:-122.6,pin_version:new Date().toISOString(),accuracy_meters:20}})});
  try{
    let context={kind:'typed',address:'999 New St, Portland, OR 97201',valid:true,lead:null};
    h.w.MCCOY_LEAD_ADDRESS.current=()=>context;
    h.w.MCCOY_LEAD_ADDRESS.setLead=lead=>context={kind:'assigned',address:lead.fullAddress,valid:true,lead};
    const p=h.w.MCCOY_START_DOOR_VISIT();await turn();h.fix();await p;
    assert.equal(h.rpcs[0].name,'record_ad_hoc_door_visit_start');
    assert.equal(h.w.state.activeDoorVisit.lead.dbId,'new-door');
    assert.ok(h.w.state.leads.some(lead=>lead.dbId==='new-door'));
    const source=h.w.MCCOY_LEAD_ADDRESS_CORE.saleSource({addressContext:context,activeVisit:h.w.state.activeDoorVisit,sessionId:'session'});
    assert.equal(source.lead_id,'new-door');assert.equal(source.source_door_visit_id,'visit-a');
  }finally{h.close();}
});
test('a late visit-start response cannot restore another account or request its GPS',async()=>{
  let resolve;const h=doorHarness({startHandler:()=>new Promise(r=>resolve=r)});
  try{
    const p=h.w.MCCOY_START_DOOR_VISIT();await turn();h.w.MCCOY_ACCESS.user.id='other';
    resolve({data:{ok:true,visit_id:'old-account-visit'}});await p;
    assert.equal(h.w.state.activeDoorVisit,undefined);assert.equal(h.positions.length,0);
  }finally{h.close();}
});

test('production enables KNOCK DOOR without exposing pilot enrollment controls',async()=>{
  const h=harness({production:true,productionEnabled:true});try{
    await h.api.addAddress({address});assert.equal(h.positions.length,0);
    const p=h.api.knockDoor({visitId:'production-visit',address});await turn();h.fix();await p;
    assert.equal(h.calls.filter(c=>c.action==='knock_door').length,1);
    assert.equal(h.w.document.getElementById('gpsPlacementPilotToggle').hidden,true);
    assert.match(h.w.document.getElementById('gpsPlacementPilotStatus').textContent,/KNOCK DOOR/);
    assert.equal(h.intervals.length,0);
  }finally{h.close();}
});

test('field roles see GPS progress, denial/retry and low-accuracy success under real auth styles',async()=>{
  const authCss=readFileSync(new URL('./app-auth.js',import.meta.url),'utf8').match(/css\.textContent=`([\s\S]*?)`;/)[1];
  for(const role of ['rep','manager','trainer','tester']){
    const h=doorHarness({production:true,productionEnabled:true,role});try{
      h.w.document.body.classList.add('blind-tester');
      const style=h.w.document.createElement('style');style.textContent=authCss;h.w.document.head.appendChild(style);
      const input=h.w.document.getElementById('fieldLeadAddressInput');input.focus();input.value='unfinished edit';input.setSelectionRange(2,5);
      const visible=()=>assert.notEqual(h.w.getComputedStyle(h.status).display,'none',role+' GPS status must be visible');
      const p=h.w.MCCOY_START_DOOR_VISIT();await turn();
      assert.match(h.status.textContent,/Capturing GPS/);visible();
      h.positions[0].fail({code:1});await p;
      assert.match(h.status.textContent,/permission was denied.*KNOCK DOOR to retry/);visible();
      assert.equal(h.status.getAttribute('role'),'status');assert.equal(h.status.getAttribute('aria-live'),'polite');
      await h.api.refreshStatus();h.w.dispatchEvent(new h.w.Event('mccoy-sales-hub-layout-ready'));
      assert.match(h.status.textContent,/permission was denied/);visible();
      const retry=h.w.MCCOY_START_DOOR_VISIT();await turn();h.fix(200);await retry;
      assert.match(h.status.textContent,/2 pins placed.*Low accuracy/);visible();assert.equal(h.rpcs.length,1);
      assert.equal(h.w.getComputedStyle(h.w.document.getElementById('hiddenCoachingNote')).display,'none');
      assert.equal(h.w.document.activeElement,input);assert.equal(input.value,'unfinished edit');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,5);
    }finally{h.close();}
  }
});
