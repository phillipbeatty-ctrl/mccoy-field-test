import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import vm from 'node:vm';
const source=readFileSync(new URL('./app-gps-placement.js',import.meta.url),'utf8');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const address={address1:'100 Test St',address2:'',city:'Portland',state:'OR',zip:'97201'};
function harness({enabled=true,consent=true,production=false,handler=null}={}){
  const dom=new JSDOM('<div class="field-lead-combobox"><div><input id="fieldLeadAddressInput"><button id="addFieldAddressBtn">ADD ADDRESS</button></div><div id="fieldLeadAddressStatus"></div></div>',{
    runScripts:'outside-only',pretendToBeVisual:true,url:production?'https://www.mccoyplatform.com/':'http://localhost:3000/'});
  const w=dom.window,calls=[],positions=[],intervals=[];
  w.MCCOY_ACCESS={user:{id:'actor'},access:{organization_id:'org',active:true,role:'admin'}};
  w.mccoyConsentAccepted=consent;w.state={realLeads:[]};
  w.setInterval=(...args)=>{intervals.push(args);return 1;};
  Object.defineProperty(w.navigator,'geolocation',{value:{getCurrentPosition:(ok,fail,options)=>positions.push({ok,fail,options})}});
  w.sb={functions:{invoke:async(name,{body})=>{
    calls.push({name,...body});
    if(body.action==='status')return{data:{ok:true,enabled,can_manage:true,consented:consent}};
    if(handler)return handler(body);
    if(body.action==='set_pilot')return{data:{ok:true,enabled:body.input.enabled,can_manage:true,consented:consent}};
    return{data:{ok:true,source:'user_reported_door',moved_count:2,accuracy_meters:200,low_accuracy:true,requires_door_selection:true,lead:null}};
  }}};
  vm.runInContext(source,dom.getInternalVMContext());
  const fix=(accuracy=200,timestamp=Date.now())=>positions.at(-1).ok({timestamp,coords:{latitude:45.5,longitude:-122.6,accuracy}});
  return{w,dom,calls,positions,intervals,fix,api:w.MCCOY_GPS_PLACEMENT,close:()=>w.close()};
}
test('pilot stays off on production and has no GPS watchers or polling',async()=>{
  const h=harness({production:true});try{
    assert.equal(await h.api.placeAddress({address}),null);assert.equal(h.calls.length,0);assert.equal(h.positions.length,0);assert.equal(h.intervals.length,0);
  }finally{h.close();}
});
test('disabled pilot retains legacy address behavior without prompting for GPS',async()=>{
  const h=harness({enabled:false});try{assert.equal(await h.api.placeAddress({address}),null);assert.equal(h.positions.length,0);}finally{h.close();}
});
test('poor GPS places the group, retains the browser capture time and does not choose a duplicate',async()=>{
  const h=harness();try{
    const p=h.api.placeAddress({address});await turn();const captured=Date.now()-1000;h.fix(200,captured);const result=await p;
    const call=h.calls.find(c=>c.action==='place_address');assert.equal(call.input.gps.captured_at,new Date(captured).toISOString());
    assert.equal(call.input.gps.accuracy_meters,200);assert.equal(call.input.address.address1,address.address1);assert.ok(call.input.request_id);
    assert.match(h.api.placementMessage(result),/2 pins placed/);assert.match(h.api.placementMessage(result),/Low accuracy/);assert.match(h.api.placementMessage(result),/stacked pins/);
    assert.equal(result.lead,null);assert.equal(h.positions[0].options.maximumAge,0);assert.equal(h.intervals.length,0);
  }finally{h.close();}
});
test('late GPS cannot submit a changed address or changed account',async()=>{
  for(const accountChange of [false,true]){
    const h=harness();try{let current=true;const p=h.api.placeAddress({address,isCurrent:()=>current});await turn();
      if(accountChange)h.w.MCCOY_ACCESS.user.id='other';else current=false;
      h.fix();assert.equal(await p,null);assert.equal(h.calls.filter(c=>c.action==='place_address').length,0);
    }finally{h.close();}
  }
});
test('denied consent and invalid or expired GPS leave the address unchanged',async()=>{
  const no=harness({consent:false});try{await assert.rejects(no.api.placeAddress({address}),/location notice/);assert.equal(no.positions.length,0);}finally{no.close();}
  for(const accuracy of [-1,null,NaN]){
    const h=harness();try{const p=h.api.placeAddress({address});await turn();h.fix(accuracy);await assert.rejects(p,/current GPS/);assert.equal(h.calls.filter(c=>c.action==='place_address').length,0);}finally{h.close();}
  }
  const h=harness();try{const p=h.api.placeAddress({address});await turn();h.fix(10,Date.now()-60000);await assert.rejects(p,/current GPS/);}finally{h.close();}
});
test('a lost response retries the same immutable request without moving twice',async()=>{
  let tries=0;const h=harness({handler:()=>++tries===1?{error:new Error('offline')}:{data:{ok:true,replayed:true}}});
  try{const p=h.api.placeAddress({address});await turn();h.fix();await assert.rejects(p,/retry/);
    assert.equal((await h.api.placeAddress({address})).replayed,true);
    const calls=h.calls.filter(c=>c.action==='place_address');assert.equal(JSON.stringify(calls[0].input),JSON.stringify(calls[1].input));assert.equal(h.positions.length,1);
  }finally{h.close();}
});
test('a definite stale-location rejection asks for a fresh reading on the next press',async()=>{
  let tries=0;const h=harness({handler:()=>++tries===1?{data:{ok:false,error:'stale_location'}}:{data:{ok:true}}});
  try{const p=h.api.placeAddress({address});await turn();h.fix();await assert.rejects(p,/pin changed/);
    const retry=h.api.placeAddress({address});await turn();h.fix();await retry;
    const calls=h.calls.filter(c=>c.action==='place_address');assert.notEqual(calls[0].input.request_id,calls[1].input.request_id);assert.equal(h.positions.length,2);
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
test('only explicit physical visits acquire refinement GPS',async()=>{
  const h=harness();try{
    for(const activityType of ['Call','Text','Appointment'])assert.equal(await h.api.captureForDisposition({activityType}),null);
    assert.equal(await h.api.captureForDisposition({activityType:'Visit',automatic:true}),null);assert.equal(h.positions.length,0);
    const p=h.api.captureForDisposition({activityType:'Visit'});await turn();h.fix(10);assert.equal((await p).placementAccount,'actor:org');
  }finally{h.close();}
});
test('refinement updates only its pin and preserves a successful disposition when location saving fails',async()=>{
  const h=harness({handler:()=>({data:{ok:true,source:'user_reported_door',lead_ids:['a'],moved_count:1,latitude:46,longitude:-123,accuracy_meters:5,pin_version:new Date().toISOString()}})});
  try{
    h.w.state.realLeads=[{dbId:'a',lat:40},{dbId:'b',lat:40}];
    const gps={lat:46,lng:-123,accuracy:5,capturedAt:Date.now(),placementAccount:'actor:org'};
    assert.match(await h.api.dispositionSaved({visitId:'v',leadId:'a',gps}),/improved/);
    assert.equal(h.w.state.realLeads[0].lat,46);assert.equal(h.w.state.realLeads[1].lat,40);
    h.w.sb.functions.invoke=async()=>({error:new Error('offline')});
    assert.match(await h.api.dispositionSaved({visitId:'v2',leadId:'a',gps}),/Disposition saved/);
    h.w.MCCOY_ACCESS.user.id='other';assert.equal(await h.api.dispositionSaved({visitId:'v3',leadId:'a',gps}),'');
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
