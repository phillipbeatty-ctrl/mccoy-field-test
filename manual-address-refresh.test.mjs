import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const coreScope={module:{exports:{}}};
vm.runInNewContext(read('./app-lead-address-core.js'),coreScope);
const core=coreScope.module.exports;
const address='100 Main St, Portland, OR 97201';
const original={id:100000,dbId:'lead-a',address:'100 Main St',fullAddress:address,lat:45,lng:-122};
const different={id:100000,dbId:'lead-b',address:'800 Oak Ave',fullAddress:'800 Oak Ave, Boise, ID 83702'};
const clone=value=>JSON.parse(JSON.stringify(value));
function fn(path,name){
  const text=read(path),start=text.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start>=0);const end=text.indexOf('\n  }',start);assert.ok(end>start);
  return text.slice(start,end+4);
}
class Element{
  constructor(tag='div'){this.tag=tag;this._value='';this.options=[];this.listeners=new Map();this.classList={add(){},toggle(){},remove(){}};}
  get value(){return this._value;}
  set value(value){this._value=this.tag==='select'&&!this.options.some(option=>option.value===String(value))?'':String(value);}
  add(option){this.options.push(option);}
  addEventListener(name,callback){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(callback);}
  dispatchEvent(event){for(const callback of this.listeners.get(event.type)||[])callback(event);}
  setAttribute(){}
  insertAdjacentElement(){}
  replaceChildren(...children){this.children=children;}
  focus(){}
}
function context(seed={}){
  const s=vm.createContext({console:{error(){}},Event:class{constructor(type){this.type=type}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}},...seed});
  s.window=s;return s;
}
function addressHarness(){
  const nodes=new Map(['fieldLeadSelect','fieldLeadAddressInput','fieldLeadAddressStatus','addFieldAddressBtn'].map(id=>[id,new Element(id==='fieldLeadSelect'?'select':'div')]));
  const state={leads:[{...original}],activeDoorVisit:null};
  const s=context({inputState:state,MCCOY_LEAD_ADDRESS_CORE:core,document:{getElementById:id=>nodes.get(id)||null,createElement:tag=>new Element(tag)},addEventListener(){},dispatchEvent(){},setTimeout(){}});
  // Production uses a lexical binding; window.state is intentionally absent.
  vm.runInContext('const state=inputState;',s);delete s.inputState;
  vm.runInContext(read('./app-typed-lead-address.js'),s);
  return{s,state,nodes,api:s.MCCOY_LEAD_ADDRESS};
}

test('refresh retains the chosen database lead when numeric row IDs are reused',()=>{
  const {state,api,nodes}=addressHarness();api.setLead(state.leads[0]);
  state.leads=[{...different},{...original,id:100001}];
  api.refresh();
  assert.equal(nodes.get('fieldLeadAddressInput').value,address);
  assert.equal(api.current().lead.dbId,'lead-a');assert.equal(nodes.get('fieldLeadSelect').value,'100001');
});

test('refresh keeps typed input and an explicit clear despite stale native selection',()=>{
  const {state,api,nodes}=addressHarness();api.setTyped(different.fullAddress,'user_input');
  const select=nodes.get('fieldLeadSelect');select.add({value:'100000'});select.value='100000';
  state.leads=[{...original}];api.refresh();assert.equal(api.current().address,different.fullAddress);
  assert.equal(api.current().lead,null);assert.equal(select.value,'');
  api.clear();select.value='100000';api.refresh();assert.equal(api.current().kind,'empty');assert.equal(select.value,'');
});

test('refresh preserves explicit identity among equal-address duplicates',()=>{
  const {state,api}=addressHarness();api.setLead(state.leads[0]);
  state.leads=[{...original,dbId:'duplicate'},{...original,id:100001}];api.refresh();
  assert.equal(api.current().lead.dbId,'lead-a');
});

test('manual map choice outside the 750 initial options remains selected',()=>{
  const {state,api,nodes}=addressHarness();state.leads=Array.from({length:800},(_,index)=>({...original,id:100000+index,dbId:`lead-${index}`,fullAddress:`${index} Main St, Portland, OR 97201`}));
  api.refresh();api.setLead(state.leads[799],'map_pin');
  assert.equal(api.current().lead.dbId,'lead-799');assert.equal(nodes.get('fieldLeadSelect').value,'100799');
});

test('address save feedback survives list refresh and blur until the user edits',()=>{
  const {api,nodes}=addressHarness();api.setTyped(different.fullAddress,'user_input');
  const revision=api.revision();api.setMessage('Address added. Ready for SALE.');api.refresh();
  nodes.get('fieldLeadAddressInput').dispatchEvent({type:'change'});
  assert.equal(api.revision(),revision);assert.equal(nodes.get('fieldLeadAddressStatus').textContent,'Address added. Ready for SALE.');
  api.setTyped('900 New Ave, Boise, ID 83702','user_input');assert.ok(api.revision()>revision);
  assert.notEqual(nodes.get('fieldLeadAddressStatus').textContent,'Address added. Ready for SALE.');
});

function resumeHarness({initial='',typedVisit=false}={}){
  let resolve,revision=0,current={address:initial},writes=0;
  const request=new Promise(done=>{resolve=done}),nodes=new Map();
  const state={leads:[original],session:null};
  const s=context({state,resumeAttempted:false,addressContext:()=>current,sb:{rpc:()=>request},MCCOY_LEAD_ADDRESS_CORE:core,
    MCCOY_LEAD_ADDRESS:{revision:()=>revision,setTyped:value=>{current={address:value};writes++;}},
    chooseLead:lead=>{current={address:lead.fullAddress};writes++;},startGpsWatch(){},startTimer(){},startDoorTimer(){},telemetryStatus(){},dispatchEvent(){},render(){},
    byId:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}});
  vm.runInContext(fn('./app-distance-to-lead.js','resumeWorkflow'),s);
  return {s,state,start:()=>vm.runInContext('resumeWorkflow()',s),edit:value=>{current={address:value};revision++;},get address(){return current.address;},get writes(){return writes;},finish:()=>resolve({data:{ok:true,session:{id:'session-a',started_at:'2026-09-11T08:00:00Z'},visit:{id:'visit-a',lead_id:typedVisit?null:'lead-a',lead_label:address,selection_source:typedVisit?'typed_address':'manual_lead',started_at:'2026-09-11T08:01:00Z'}}})};
}

for(const typedVisit of [false,true]){
  test(`late ${typedVisit?'typed':'assigned'} visit restore does not overwrite a new address or cleared input`,async()=>{
    for(const next of [different.fullAddress,'']){
      const h=resumeHarness({typedVisit}),pending=h.start();h.edit(different.fullAddress);h.edit(next);h.finish();await pending;
      assert.equal(h.address,next);assert.equal(h.writes,0);assert.equal(h.state.activeDoorVisit.serverVisitId,'visit-a');
    }
  });
}
test('session restore preserves existing input and still restores an untouched empty address',async()=>{
  for(const initial of ['',different.fullAddress]){
    const h=resumeHarness({initial}),pending=h.start();h.finish();await pending;
    assert.equal(h.address,initial||address);assert.equal(h.writes,initial?0:1);
  }
});

test('the pin editor resolves leads from production lexical state without window.state',()=>{
  const s=context({inputState:{realLeads:[original]}});vm.runInContext('const state=inputState;',s);delete s.inputState;
  vm.runInContext(fn('./app-field-lead-editor.js','leadByAnyId'),s);
  assert.equal(s.state,undefined);assert.equal(vm.runInContext("leadByAnyId('lead-a').dbId",s),'lead-a');
  assert.equal(vm.runInContext("leadByAnyId('100000').dbId",s),'lead-a');
});

test('saved pins clear hiding display filters, render, select and center the accessible lead',()=>{
  const filters=new Map(['teamFilter','leadOwnerFilter','leadSearch'].map(id=>[id,{value:'old filter'}]));const calls=[];
  const s=context({byId:id=>filters.get(id),MCCOY_LEAD_MATCHES_FILTER:()=>false,renderLeads:()=>calls.push('list'),MCCOY_RENDER_LEAD_MAP:()=>calls.push('map'),MCCOY_SELECT_MAP_LEAD:id=>calls.push(id),dispatchEvent:event=>calls.push(event.detail.source),MCCOY_LEAD_MAP:{map:{getZoom:()=>12,setView:(point,zoom)=>calls.push([clone(point),zoom])}}});
  vm.runInContext(fn('./app-field-lead-editor.js','showSavedPin'),s);s.lead=original;assert.equal(vm.runInContext('showSavedPin(lead)',s),true);
  assert.ok([...filters.values()].every(filter=>filter.value===''));
  assert.deepEqual(calls,['list','map','lead-a','field_created_address',[[45,-122],18]]);
  calls.length=0;s.MCCOY_MAP_VIEWPORT_LOCK={blocksSelection:()=>true};assert.equal(vm.runInContext('showSavedPin(lead)',s),false);assert.equal(calls.length,0);
});

test('a saved pin missed by an in-flight list request gets one fresh reload',async()=>{
  let loads=0,selected=null;const state={realLeads:[]},messages=[];
  const s=context({inputState:state,creatingLead:false,byId:()=>null,addressFields:()=>({address1:'100 Main St',city:'Portland',state:'OR',zip:'97201'}),inputValue:()=>'',setCreateMessage:message=>messages.push(message),call:async()=>({created:true,lead:{id:'lead-a'}}),loadMcCoyLeads:async()=>{if(++loads===2)state.realLeads=[original];},showSavedPin:lead=>{selected=lead;return true;}});
  vm.runInContext('const state=inputState;',s);delete s.inputState;
  vm.runInContext(fn('./app-field-lead-editor.js','leadByAnyId')+'\n'+fn('./app-field-lead-editor.js','createLead'),s);
  await vm.runInContext('createLead()',s);assert.equal(loads,2);assert.equal(selected.dbId,'lead-a');assert.match(messages.at(-1),/pin is selected/);
});

test('refresh failure after insert reports a saved address and retains the sale option',async()=>{
  const messages=[];
  const s=context({creatingLead:false,byId:()=>null,addressFields:()=>({address1:'100 Main St',city:'Portland',state:'OR',zip:'97201'}),inputValue:()=>'',setCreateMessage:message=>messages.push(message),call:async()=>({created:true,lead:{id:'lead-a'}}),loadMcCoyLeads:async()=>{throw new Error('offline');}});
  vm.runInContext(fn('./app-field-lead-editor.js','createLead'),s);await vm.runInContext('createLead()',s);
  assert.match(messages.at(-1),/address was saved/);assert.match(messages.at(-1),/still process the sale/);assert.equal(s.creatingLead,false);
});

test('SALE restores a maximized map so the provider chooser is visible',()=>{
  let expanded=true;const nodes=new Map();
  const s=context({document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);}},actorKey:()=>'actor:org',currentProvider:()=>'Other',saleSourceContext:()=>({service_address:address,preserve_active_visit:true}),choice:new Element(),pending:null,routing:false,panel:new Element(),updatePortalStatus(){},setTimeout(){},structuredClone,MCCOY_LEAD_MAP_WINDOW:{restore:()=>{expanded=false;}}});
  vm.runInContext(fn('./app-provider-sale-router.js','showRouter'),s);vm.runInContext('showRouter({})',s);
  assert.equal(expanded,false);assert.equal(s.pending.source.service_address,address);
});
