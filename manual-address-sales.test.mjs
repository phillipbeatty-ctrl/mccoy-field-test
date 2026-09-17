import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
const coreScope={module:{exports:{}}};
vm.runInNewContext(read('./app-lead-address-core.js'),coreScope);
const core=coreScope.module.exports;
const lead={id:1,dbId:'lead-a',address:'100 Main St',city:'Portland',stateCode:'OR',zip:'97201',fullAddress:'100 Main St, Portland, OR 97201',lat:45,lng:-122};
const other='100 Main St Apt 9, Boise, ID 83702';
const copy=value=>JSON.parse(JSON.stringify(value));
// Execute the actual production functions with controlled I/O. No production RPCs.
function fn(file,name){
  const source=read(file),match=new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match,`${name} exists`);
  const start=match.index,end=source.indexOf('\n  }',start);
  // Single-line utility functions end before the next declaration.
  const lineEnd=source.indexOf('\n',start);
  if(source.slice(start,lineEnd).endsWith('}'))return source.slice(start,lineEnd);
  assert.ok(end>start,`${name} closes`);return source.slice(start,end+4);
}
function scope(seed={}){const value={console,structuredClone,setTimeout,clearTimeout,Event:class{constructor(type){this.type=type}},...seed};value.window=value;return vm.createContext(value);}
function element(value=''){return{value,disabled:false,textContent:'',classList:{add(){},remove(){}},focus(){},dispatchEvent(){}};}

test('release defaults and missing configuration keep nearest automation paused',()=>{
  const s=scope();vm.runInContext(read('./app-field-features.js'),s);
  assert.equal(s.MCCOY_FIELD_FEATURES.automaticNearestLead,false);assert.equal(Object.isFrozen(s.MCCOY_FIELD_FEATURES),true);
  for(const [file,name,seed] of [
    ['./app-closest-lead-autofill-v2.js','run',{}],
    ['./app-closest-lead-autofill-v2.js','applyLead',{}],
    ['./app-lead-pool-independent-activity.js','autoSelectNearest',{}],
    ['./app-auto-door-arrival.js','evaluateAutoArrival',{resetCandidate(){},restoreManualButton(){}}]
  ]){
    const context=scope({...seed,autoNearestEnabled:()=>false});
    vm.runInContext(fn(file,name),context);
    // These calls have no GPS/RPC/map dependencies available: touching any fails.
    vm.runInContext(`${name}()`,context);
  }
});

test('distance refresh and arrival/departure ticks preserve manual intent without nearest work',()=>{
  let changed=0,nearestCalls=0,arrivals=0,departures=0;
  const s=scope({state:{leads:[lead],latestGps:{lat:45,lng:-122},activeDoorVisit:null},select:{value:'',dispatchEvent(){changed++}},core:{nearestLead(){nearestCalls++;return{lead}},distanceState(){return{}}},autoNearestEnabled:()=>false,manualLeadLocked:false,addressContext:()=>({kind:'empty'}),selectedLead:()=>null,resetArrival(){arrivals++},resetDeparture(){departures++},render:()=>({})});
  vm.runInContext(fn('./app-distance-to-lead.js','calculate')+'\n'+fn('./app-distance-to-lead.js','evaluateAutomation'),s);
  for(let i=0;i<8;i++)vm.runInContext('calculate();evaluateAutomation();',s);
  assert.equal(changed,0);assert.equal(nearestCalls,0);assert.equal(arrivals,8);assert.equal(departures,8);
});

test('manual lead selection still works while automatic selection is stopped',()=>{
  const select=element(),s=scope({select,autoNearestEnabled:()=>false,ensureOption(){},autoChanging:false,manualLeadLocked:true,lead});
  vm.runInContext(fn('./app-distance-to-lead.js','chooseLead'),s);
  vm.runInContext('chooseLead(lead,true)',s);assert.equal(select.value,'');
  vm.runInContext('chooseLead(lead,false)',s);assert.equal(select.value,'1');
});

test('same street in a different city or unit never becomes the existing lead',()=>{
  for(const address of [other,'100 Main St, Boise, ID 83702','100 Main St'])assert.equal(core.context({value:address,leads:[lead],selectedId:1}).kind,'typed');
  assert.equal(core.context({value:lead.fullAddress,leads:[lead]}).lead.dbId,'lead-a');
  assert.equal(core.context({value:lead.fullAddress,leads:[lead,{...lead,id:2,dbId:'duplicate'}]}).kind,'typed');
});

test('any-address sale needs no lead, GPS, session or pin and preserves an unrelated door',()=>{
  const source=core.saleSource({addressContext:core.context({value:other,leads:[lead]}),activeVisit:{serverVisitId:'visit-a',lead}});
  assert.equal(source.service_address,other);assert.equal(source.lead_id,null);assert.equal(source.customer_map_location,null);assert.equal(source.session_id,null);assert.equal(source.source_door_visit_id,null);assert.equal(source.preserve_active_visit,true);
});

test('only the matching selected physical door is linked for sale completion',()=>{
  const context=core.context({value:lead.fullAddress,leads:[lead]});
  assert.equal(core.saleSource({addressContext:context,activeVisit:{serverVisitId:'visit-a',lead}}).source_door_visit_id,'visit-a');
  assert.equal(core.saleSource({addressContext:context,activeVisit:{serverVisitId:'visit-b',lead:{...lead,dbId:'lead-b'}}}).source_door_visit_id,null);
  const typed=core.context({value:other});
  assert.equal(core.saleSource({addressContext:typed,activeVisit:{serverVisitId:'typed-visit',lead:core.adHocLead(other)}}).source_door_visit_id,'typed-visit');
  assert.equal(core.saleSource({addressContext:core.context({value:''})}),null);
});

test('SALE freezes the selected address before the provider choice, and cancel clears intent',()=>{
  const nodes=new Map(),byId=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
  const source={service_address:other,sale_context:'field',lead_id:null,preserve_active_visit:true};
  const s=scope({document:{getElementById:byId},currentProvider:()=> 'Other',saleSourceContext:()=>source,choice:element(),pending:null,routing:false,panel:element(),updatePortalStatus(){},updateBrokerField(){},setTimeout(){},MCCOY_PENDING_SALE_CONTEXT:source,target:{}});
  vm.runInContext(fn('./app-provider-sale-router.js','showRouter')+'\n'+fn('./app-provider-sale-router.js','closeRouter'),s);
  vm.runInContext('showRouter(target)',s);source.service_address=lead.fullAddress;source.lead_id='lead-a';
  assert.equal(s.pending.source.service_address,other);assert.equal(s.pending.source.lead_id,null);
  vm.runInContext('closeRouter()',s);assert.equal(s.pending,null);assert.equal(s.MCCOY_PENDING_SALE_CONTEXT,null);
});

function addressSearchHarness(){
  const nodes={leadPoolPhoneAddress:element(other),leadPoolPhoneSaleBtn:element(),leadPoolCenterAddressBtn:element()};let resolve;
  const request=new Promise(done=>{resolve=done});
  const s=scope({byId:id=>nodes[id],state:{realLeads:[lead]},phoneContext:null,phoneSearchBusy:false,addressRevision:0,MCCOY_LEAD_ADDRESS_CORE:core,MCCOY_ACCESS:{user:{id:'rep-a'},access:{organization_id:'org-a'}},explicitSaleContext:({lead,address,source})=>({lead_id:lead?.dbId||null,service_address:address,source,preserve_active_visit:true}),phoneMessage(){},validPoint:()=>null,leadAddress:lead=>lead?.fullAddress||'',applyPhoneSearchResult(){throw new Error('stale result changed the map')},sb:{functions:{invoke:()=>request}}});
  vm.runInContext(['localAddressMatch','updateAddressIntent','searchPhoneAddress'].map(name=>fn('./app-lead-pool-independent-activity.js',name)).join('\n'),s);
  return{s,nodes,resolve};
}

test('typing immediately enables SALE without running geocoding',()=>{
  const{s,nodes}=addressSearchHarness();vm.runInContext('updateAddressIntent()',s);
  assert.equal(nodes.leadPoolPhoneSaleBtn.disabled,false);assert.equal(s.phoneContext.service_address,other);assert.equal(s.phoneContext.lead_id,null);assert.equal(s.phoneSearchBusy,false);
  nodes.leadPoolPhoneAddress.value='';vm.runInContext('updateAddressIntent()',s);assert.equal(nodes.leadPoolPhoneSaleBtn.disabled,true);
});

test('the Lead Pool phone-address flow retains the classification used for Admin approval',()=>{
  const nodes={leadPoolPhoneAddress:element(other),leadPoolPhoneSaleBtn:element()};
  const s=scope({byId:id=>nodes[id],state:{realLeads:[lead]},phoneContext:null,MCCOY_LEAD_ADDRESS_CORE:core,currentSessionId:()=>null,validPoint:()=>null,leadAddress:value=>value?.fullAddress||'',phoneMessage(){}});
  vm.runInContext(['explicitSaleContext','localAddressMatch','updateAddressIntent'].map(name=>fn('./app-lead-pool-independent-activity.js',name)).join('\n'),s);
  vm.runInContext('updateAddressIntent()',s);
  assert.equal(s.phoneContext.sale_context,'out_of_area_phone');assert.equal(s.phoneContext.service_address,other);
  s.MCCOY_PENDING_SALE_CONTEXT=s.phoneContext;vm.runInContext(fn('./app-provider-sale-router.js','saleSourceContext'),s);
  const captureSource=vm.runInContext('saleSourceContext()',s);
  assert.equal(captureSource.sale_context,'out_of_area_phone');assert.equal(captureSource.preserve_active_visit,true);assert.equal(captureSource.source_door_visit_id,null);
  assert.equal(core.saleSource({addressContext:core.context({value:other})}).sale_context,'field');
});

for(const failure of [false,true])test(`late ${failure?'failed':'successful'} map lookup cannot replace a newly typed sale address`,async()=>{
  const{s,nodes,resolve}=addressSearchHarness();const pending=vm.runInContext('searchPhoneAddress()',s);
  nodes.leadPoolPhoneAddress.value='800 Oak Ave, Boise, ID 83702';s.addressRevision++;vm.runInContext('updateAddressIntent()',s);
  resolve(failure?{error:new Error('offline')}:{data:{ok:true,service_address:other,lead:{id:'lead-a'}}});await pending;
  assert.equal(s.phoneContext.service_address,nodes.leadPoolPhoneAddress.value);assert.equal(s.phoneContext.lead_id,null);assert.equal(nodes.leadPoolPhoneSaleBtn.disabled,false);
});

test('geocoding failure retains an immediately usable sale address',async()=>{
  const{s,nodes,resolve}=addressSearchHarness();const pending=vm.runInContext('searchPhoneAddress()',s);resolve({error:new Error('offline')});await pending;
  assert.equal(s.phoneContext.service_address,other);assert.equal(nodes.leadPoolPhoneSaleBtn.disabled,false);
});

test('address entry is exposed only for active supported field roles',()=>{
  const s=scope();vm.runInContext(fn('./app-field-lead-editor.js','fieldRole'),s);
  for(const role of ['admin','manager','trainer','rep','tester']){s.MCCOY_ACCESS={access:{active:true,role}};assert.equal(vm.runInContext('fieldRole()',s),true);s.MCCOY_ACCESS.access.active=false;assert.equal(vm.runInContext('fieldRole()',s),false);}
});

test('blank optional contact fields cannot erase a matched existing lead',async()=>{
  let body;
  const nodes={createFieldLeadBtn:element()},values={newLeadCustomerName:'',newLeadPhone:'',newLeadNotes:''};
  const s=scope({creatingLead:false,byId:id=>nodes[id],addressFields:()=>({address1:'100 Main St',address2:'',city:'Portland',state:'OR',zip:'97201'}),inputValue:id=>values[id]||'',setCreateMessage(){},call:async(action,input)=>{body=input;return{created:false}},loadMcCoyLeads:async()=>{}});
  vm.runInContext(fn('./app-field-lead-editor.js','createLead'),s);await vm.runInContext('createLead()',s);
  assert.deepEqual(copy(body),{address1:'100 Main St',address2:'',city:'Portland',state:'OR',zip:'97201'});
});

test('web cache loads the pause before all legacy automatic selectors',()=>{
  const html=read('./index.html'),worker=read('./service-worker.js'),layout=read('./app-page-layout.js');
  for(const name of ['app-part1.js','app-distance-to-lead.js','app-auto-door-arrival.js'])assert.ok(html.indexOf('app-field-features.js')<html.indexOf(name));
  assert.match(worker,/field-coach-app-shell-v25-20260914-photo-outcome-fixes/);
  for(const name of ['app-field-features.js','app-typed-lead-address.js','app-provider-sale-router.js','app-field-lead-editor.js'])assert.ok(worker.includes(name+'?v='+(name==='app-provider-sale-router.js'?'2026091105':name==='app-field-features.js'?'2026091103':name==='app-field-lead-editor.js'?'2026092001':'2026091108')));
  assert.match(layout,/app-closest-lead-autofill-v2\.js\?v=\d+/);
  assert.match(read('./app-part1.js'),/<option value="">Type an address or select a lead<\/option>/);
});
