import test from 'node:test';
import assert from 'node:assert/strict';
import {ui,loadAddress,fieldMarkup,read,turn,deferred} from './test-support/ui-dom.mjs';

const lead={id:1,dbId:'lead-a',address:'100 Main St',city:'Portland',stateCode:'OR',zip:'97201',customerName:'Saved name',phone:'5550100',notes:'Saved notes'};
const other={...lead,id:2,dbId:'lead-b',address:'200 Oak St'};

test('typing resolves once, reuses the result, and never rescans an unchanged lead pool',()=>{
  const h=ui();let addressReads=0;
  const leads=Array.from({length:10000},(_,i)=>({id:i+1,dbId:'lead-'+i,get address(){addressReads++;return `${i} Synthetic St`;},city:'Portland',stateCode:'OR',zip:'97201'}));
  const input=loadAddress(h,leads),core=h.window.MCCOY_LEAD_ADDRESS_CORE,original=core.context;
  let resolves=0,changes=0,nativeChanges=0;core.context=args=>{resolves++;return original(args);};
  h.window.addEventListener('mccoy-lead-address-changed',()=>{changes++;h.window.MCCOY_LEAD_ADDRESS.current();});
  h.document.getElementById('fieldLeadSelect').addEventListener('change',()=>nativeChanges++);
  addressReads=0;h.type(input,'90000 New St, Boise, ID 83702');
  for(let i=0;i<20;i++)h.window.MCCOY_LEAD_ADDRESS.current();
  input.dispatchEvent(new h.window.Event('change',{bubbles:true}));
  assert.equal(resolves,1);assert.equal(changes,1);assert.equal(nativeChanges,0);assert.equal(addressReads,0);
  h.close();
});

test('index refresh retains full address and explicit duplicate identity across reused row IDs',()=>{
  const h=ui(),input=loadAddress(h,[{...lead}]);const api=h.window.MCCOY_LEAD_ADDRESS;
  api.setLead(h.window.state.leads[0]);
  h.window.state.leads=[{...lead,dbId:'duplicate'},{...lead,id:3}];
  h.emit('mccoy-real-leads-loaded');
  // Consumers may read the context before the coalesced UI refresh executes.
  assert.equal(api.current().lead.dbId,'lead-a');h.clock.flush();
  assert.equal(api.current().lead.dbId,'lead-a');assert.equal(h.document.getElementById('fieldLeadSelect').value,'3');
  h.type(input,'100 Main St Apt 2, Portland, OR 97201');assert.equal(api.current().kind,'typed');
  h.type(input,'100 Main St, Boise, ID 83702');assert.equal(api.current().kind,'typed');
  api.clear();h.type(input,'100 Main St, Portland, OR 97201');assert.equal(api.current().kind,'typed');assert.equal(api.current().ambiguousAssignedMatch,true);
  h.close();
});

test('a corrected address invalidates the cached index without replacing a typed draft',()=>{
  const h=ui(),input=loadAddress(h,[{...lead}]),api=h.window.MCCOY_LEAD_ADDRESS;
  h.type(input,'900 New Rd, Boise, ID 83702');input.focus();input.setSelectionRange(3,6);
  h.window.state.leads[0].address='101 Main St';
  for(let i=0;i<10;i++)h.emit('mccoy-lead-address-corrected');
  assert.equal(h.clock.pending.size,1);h.clock.flush();
  assert.equal(h.document.activeElement,input);assert.equal(input.selectionStart,3);assert.equal(api.current().address,'900 New Rd, Boise, ID 83702');
  h.type(input,'101 Main St, Portland, OR 97201');assert.equal(api.current().lead.dbId,'lead-a');h.close();
});

test('paused automation installs no polling or global input listener while manual actions remain usable',()=>{
  const h=ui(),input=loadAddress(h,[{...lead}]);let rpcCalls=0,globalInputs=0;
  const listen=h.document.addEventListener.bind(h.document);h.document.addEventListener=(name,...args)=>{if(name==='input')globalInputs++;return listen(name,...args);};
  h.window.sb={rpc:()=>{rpcCalls++;throw new Error('Unexpected automation request');}};
  h.load('app-distance-to-lead.js');h.load('app-auto-door-arrival.js');h.load('app-closest-lead-autofill-v2.js');h.clock.flush();
  assert.equal(h.clock.intervals.size,0);assert.equal(globalInputs,0);
  h.type(input,'999 Outside Rd, Boise, ID 83702');
  const context=h.window.MCCOY_DISTANCE_TO_LEAD_CONTROL.current();assert.equal(context.ok,true);assert.equal(context.selectionSource,'typed_address');
  h.window.MCCOY_DISTANCE_TO_LEAD_CONTROL.useClosest();assert.equal(input.value,'999 Outside Rd, Boise, ID 83702');assert.equal(rpcCalls,0);h.close();
});

test('refresh bursts share one request and updates during a request get one later, non-overlapping pass',async()=>{
  const h=ui(),first=deferred(),second=deferred(),calls=[];
  const refresh=h.window.MCCOY_UI.coalesceRefresh(value=>{calls.push(value);return calls.length===1?first.promise:second.promise;});
  const a=refresh('initial'),b=refresh('latest initial');assert.equal(a,b);h.clock.flush();assert.deepEqual(calls,['latest initial']);
  const c=refresh('sale one'),d=refresh('sale two');assert.equal(c,d);assert.notEqual(c,a);h.clock.flush();assert.equal(calls.length,1);
  first.resolve('old result');assert.equal(await a,'old result');await turn();h.clock.flush();assert.deepEqual(calls,['latest initial','sale two']);
  second.resolve('new result');assert.equal(await c,'new result');assert.equal(h.clock.pending.size,0);h.close();
});

test('map colors use exact lead IDs, avoid unrelated clicks, and defer hidden work',async()=>{
  const h=ui('<section id="leads"><div id="leadMapPanel"><div id="leadGeoControls"></div><div id="leadMapFrame"><i class="lead-house-icon" data-mccoy-lead-id="lead-a"></i><i class="lead-house-icon" data-mccoy-lead-id="lead-b"></i></div></div></section><input id="unrelated">');
  let visible=true,addressReads=0;h.document.getElementById('leadMapFrame').getClientRects=()=>visible?[{}]:[];
  const rows=[{dbId:'lead-a',pinColor:'#ff0000'},{dbId:'lead-b',pinColor:'#00ff00'}];
  for(const row of rows)Object.defineProperty(row,'address',{get(){addressReads++;return 'Same street';}});
  h.window.state.realLeads=rows;h.load('app-lead-disposition-colors.js');h.clock.flush();await turn();h.clock.flush();
  const [a,b]=h.document.querySelectorAll('.lead-house-icon');assert.equal(a.style.getPropertyValue('--mccoy-lead-color'),'#ff0000');assert.equal(b.style.getPropertyValue('--mccoy-lead-color'),'#00ff00');assert.equal(addressReads,0);assert.equal(h.clock.intervals.size,0);
  h.document.getElementById('unrelated').click();assert.equal(h.clock.pending.size,0);
  visible=false;rows[1].pinColor='#0000ff';for(let i=0;i<20;i++)h.window.MCCOY_APPLY_DISPOSITION_COLORS();assert.equal(h.clock.pending.size,0);assert.equal(b.style.getPropertyValue('--mccoy-lead-color'),'#00ff00');
  visible=true;h.emit('mccoy-lead-map-window-mode-changed');h.clock.flush();assert.equal(b.style.getPropertyValue('--mccoy-lead-color'),'#0000ff');h.close();
});

function contactHarness(){
  const h=ui(fieldMarkup+'<section id="leadMapPanel"><div id="leadGeoControls"></div><div id="mapLeadList"></div><div id="mapLeadDetail"></div></section>');
  h.window.state.realLeads=[{...lead},{...other}];h.window.state.leads=h.window.state.realLeads;
  h.window.MCCOY_ACCESS={user:{id:'synthetic-user'},access:{active:true,role:'admin'}};
  const requests=[];h.window.sb={functions:{invoke:(name,options)=>{const request=deferred();requests.push({name,body:options.body,...request});return request.promise;}}};
  h.load('app-lead-detail-panel.js');h.load('app-field-lead-editor.js');h.emit('mccoy-map-lead-selected',{leadId:'lead-a'});h.clock.flush();
  return{...h,requests};
}
async function resolveContact(h,request,values={}){request.resolve({data:{ok:true,lead:{customer_name:'Server name',phone:'5550100',notes:'Server notes',...values}}});await turn();h.clock.flush();await turn();}

test('late contact responses and same-pin updates preserve input focus, drafts, and disposition dropdowns',async()=>{
  const h=contactHarness();assert.equal(h.requests.length,1);
  const input=h.document.getElementById('leadCustomerNameInput'),result=h.document.getElementById('mapLeadVisitResult');
  input.focus();h.type(input,'Unsaved name');input.setSelectionRange(2,5);result.value='Contacted';
  await resolveContact(h,h.requests[0]);
  h.emit('mccoy-door-visit-started');h.clock.flush();await turn();
  assert.equal(h.document.getElementById('leadCustomerNameInput'),input);assert.equal(h.document.activeElement,input);assert.equal(input.value,'Unsaved name');assert.equal(input.selectionStart,2);
  assert.equal(h.document.getElementById('mapLeadVisitResult'),result);assert.equal(result.value,'Contacted');
  h.emit('mccoy-real-leads-loaded');h.clock.flush();await resolveContact(h,h.requests.at(-1),{customer_name:'Changed remotely'});assert.equal(input.value,'Unsaved name');h.close();
});

test('edits typed during a contact save remain unsaved after the earlier save succeeds',async()=>{
  const h=contactHarness();await resolveContact(h,h.requests[0]);const input=h.document.getElementById('leadCustomerNameInput');
  h.type(input,'Submitted name');h.document.getElementById('saveLeadContactBtn').click();const save=h.requests.at(-1);assert.equal(save.body.action,'update_contact');assert.equal(save.body.customer_name,'Submitted name');
  h.type(input,'Newer draft');await resolveContact(h,save,{customer_name:'Submitted name'});assert.equal(input.value,'Newer draft');assert.match(h.document.getElementById('leadContactEditorMsg').textContent,/newer edits are still unsaved/);h.close();
});

test('typing before contact load preserves untouched server fields and waits for them before saving',async()=>{
  const h=contactHarness(),button=h.document.getElementById('saveLeadContactBtn');
  h.type(h.document.getElementById('leadCustomerNameInput'),'Typed before loading');
  assert.equal(button.disabled,true);button.click();assert.equal(h.requests.length,1);
  await resolveContact(h,h.requests[0],{phone:'5550199',notes:'Previously saved notes'});
  assert.equal(h.document.getElementById('leadCustomerNameInput').value,'Typed before loading');
  assert.equal(h.document.getElementById('leadCustomerPhoneInput').value,'5550199');
  assert.equal(h.document.getElementById('leadNotesInput').value,'Previously saved notes');
  assert.equal(button.disabled,false);assert.doesNotMatch(h.document.getElementById('leadContactEditorMsg').textContent,/Loading saved/);
  button.click();const save=h.requests.at(-1);
  assert.equal(save.body.phone,'5550199');assert.equal(save.body.notes,'Previously saved notes');
  await resolveContact(h,save,{customer_name:'Typed before loading',phone:'5550199',notes:'Previously saved notes'});h.close();
});

test('a read started before saving cannot overwrite the newer saved contact',async()=>{
  const h=contactHarness();await resolveContact(h,h.requests[0]);
  h.emit('mccoy-real-leads-loaded');h.clock.flush();const staleRead=h.requests.at(-1);
  h.type(h.document.getElementById('leadNotesInput'),'New saved notes');h.document.getElementById('saveLeadContactBtn').click();
  const save=h.requests.at(-1);assert.equal(save.body.action,'update_contact');
  await resolveContact(h,save,{notes:'New saved notes'});
  await resolveContact(h,staleRead,{notes:'Old server notes'});
  assert.equal(h.document.getElementById('leadNotesInput').value,'New saved notes');
  assert.equal(h.window.state.realLeads[0].notes,'New saved notes');h.close();
});

test('returning to a pin during its save restores its own draft and completes on the right form',async()=>{
  const h=contactHarness();await resolveContact(h,h.requests[0]);
  h.type(h.document.getElementById('leadNotesInput'),'Saving lead A');h.document.getElementById('saveLeadContactBtn').click();const save=h.requests.at(-1);
  h.emit('mccoy-map-lead-selected',{leadId:'lead-b'});h.clock.flush();await resolveContact(h,h.requests.at(-1),{notes:'Lead B notes'});
  h.emit('mccoy-map-lead-selected',{leadId:'lead-a'});h.clock.flush();
  assert.equal(h.document.getElementById('leadNotesInput').value,'Saving lead A');
  await resolveContact(h,save,{notes:'Saving lead A'});
  assert.equal(h.document.getElementById('leadNotesInput').value,'Saving lead A');assert.equal(h.document.getElementById('saveLeadContactBtn').disabled,false);h.close();
});

test('contact drafts survive switching to a different pin and back',async()=>{
  const h=contactHarness();await resolveContact(h,h.requests[0]);h.type(h.document.getElementById('leadNotesInput'),'Draft for lead A');
  h.emit('mccoy-map-lead-selected',{leadId:'lead-b'});h.clock.flush();await resolveContact(h,h.requests.at(-1),{notes:'Lead B server notes'});assert.equal(h.document.getElementById('leadNotesInput').value,'Lead B server notes');
  h.emit('mccoy-map-lead-selected',{leadId:'lead-a'});h.clock.flush();await resolveContact(h,h.requests.at(-1));assert.equal(h.document.getElementById('leadNotesInput').value,'Draft for lead A');h.close();
});

test('region dropdowns keep their node and unsaved choice through lead and roster refreshes',async()=>{
  const h=ui('<section id="teams"><div id="teamsTable"></div></section>');
  h.window.MCCOY_ACCESS={access:{active:true,role:'admin'}};
  let current='one@example.test';
  h.window.sb={functions:{invoke:async(_name,{body})=>({data:{ok:true,...(body.action==='list_regions'?{regions:[{name:'Pacific Northwest',manager_email:current,manager_name:current}],users:[{email:'one@example.test'},{email:'two@example.test'}]}:{rosters:[]})}})}};
  h.load('app-teams-regions.js');h.clock.flush();await turn();h.clock.flush();await turn();
  const select=h.document.getElementById('regionManager0');assert.equal(select.value,current);select.focus();select.value='two@example.test';select.dispatchEvent(new h.window.Event('change'));
  h.emit('mccoy-real-leads-loaded');h.emit('mccoy-access-ready');h.clock.flush();await turn();h.clock.flush();await turn();
  assert.equal(h.document.getElementById('regionManager0'),select);assert.equal(h.document.activeElement,select);assert.equal(select.value,'two@example.test');h.close();
});

async function settleUi(h){for(let i=0;i<6;i++){h.clock.flush();await turn();}}

test('dashboard background refresh preserves active Ghost settings and newer edits during save',async()=>{
  const h=ui(fieldMarkup+'<section id="dashboard"></section>'),save=deferred();
  h.window.MCCOY_ACCESS={user:{id:'synthetic-admin'},access:{active:true,role:'admin'}};
  let settings={can_edit:true,day_goal:3,week_goal:15,month_goal:30,year_goal:600};
  h.window.sb={functions:{invoke:async name=>({data:name==='company-leaders'?{ok:true,rankings:[],ghost_admin_settings:{...settings}}:{ok:true}})},rpc:()=>save.promise};
  h.load('app-compensation.js');h.window.MCCOY_REFRESH_RANKINGS();await settleUi(h);
  const input=h.document.getElementById('ghostDayGoal'),period=h.document.getElementById('repRankingPeriod');
  input.focus();h.type(input,'9');settings.day_goal=5;settings.week_goal=22;
  h.emit('mccoy-sale-saved');h.emit('mccoy-live-sales-changed');await settleUi(h);
  assert.equal(h.document.getElementById('ghostDayGoal'),input);assert.equal(h.document.activeElement,input);assert.equal(input.value,'9');assert.equal(h.document.getElementById('ghostWeekGoal').value,'22');
  h.document.getElementById('saveGhostRankingGoals').click();h.type(input,'12');settings.day_goal=9;save.resolve({data:{ok:true}});await settleUi(h);
  assert.equal(input.value,'12');assert.match(h.document.getElementById('ghostRankingSaveStatus').textContent,/newer edits are still unsaved/);
  period.focus();period.value='month';period.dispatchEvent(new h.window.Event('change'));await settleUi(h);
  assert.equal(h.document.getElementById('repRankingPeriod'),period);assert.equal(period.value,'month');assert.equal(h.document.activeElement,period);assert.equal(input.value,'12');h.close();
});

test('Sales Hub and rep dashboard share one background timer and company-leaders request',async()=>{
  const h=ui(fieldMarkup+'<section id="dashboard"></section>');
  h.window.MCCOY_ACCESS={user:{id:'synthetic-rep'},access:{active:true,role:'rep'}};
  const calls=[];const query={};for(const method of ['select','eq','gte','order'])query[method]=()=>query;query.limit=async()=>({data:[]});
  h.window.sb={functions:{invoke:async name=>{calls.push(name);return{data:{ok:true,rankings:[]}};}},from:()=>query};
  h.load('app-compensation.js');h.load('app-rep-dashboard.js');h.emit('mccoy-access-ready');await settleUi(h);
  const timers=[...h.clock.intervals.values()].filter(timer=>timer.delay===60000);assert.equal(timers.length,1);
  calls.length=0;timers[0].fn();await settleUi(h);assert.equal(calls.filter(name=>name==='company-leaders').length,1);assert.equal(calls.filter(name=>name==='pay-progress').length,1);
  Object.defineProperty(h.document,'hidden',{configurable:true,value:true});calls.length=0;timers[0].fn();await settleUi(h);assert.equal(calls.length,0);
  Object.defineProperty(h.document,'hidden',{configurable:true,value:false});h.document.dispatchEvent(new h.window.Event('visibilitychange'));await settleUi(h);assert.equal(calls.filter(name=>name==='company-leaders').length,1);h.close();
});
