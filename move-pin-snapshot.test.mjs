import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

const controls=readFileSync(new URL('./app-lead-map-window-controls.js',import.meta.url),'utf8');
const snapshotSource=readFileSync(new URL('./supabase/functions/lead-pin-snapshot/index.ts',import.meta.url),'utf8');
const timestamp='2026-09-04T00:54:25.198452+00:00';
const leadId='00000000-0000-4000-8000-000000000001';
// These synthetic coordinates require more than 15 digits to round-trip.
const snapshot={id:leadId,latitude:12.345678901234568,longitude:-98.76543210987654,pin_location_updated_at:timestamp};
const functions=controls.slice(controls.indexOf('  function releaseMovePinOwnership'),controls.indexOf('  function restoreMountedWorkflow'));
const begin=controls.split('\n').find(x=>x.includes('function beginMovePin('));
const cancel=controls.split('\n').find(x=>x.includes('function cancelWorkflow('));

function controller({invoke=async()=>({data:{ok:true,lead:snapshot},error:null})}={}){
  const lead={dbId:leadId,lat:9,lng:19,updatedAt:null};const starts=[],calls=[],hints=[];
  let released=0,context;
  const moveButton={async onclick(){starts.push({...lead});context.window.MCCOY_MAP_MOVE_PIN_ACTIVE=true;context.mode='move-pin';}};
  const cancelButton={click(){context.window.MCCOY_MAP_MOVE_PIN_ACTIVE=false;}};
  context=vm.createContext({
    STANDARD:'standard',MOVE_PIN_READY:'move-pin-ready',MOVE_PIN:'move-pin',mode:'standard',expanded:false,
    movePinLeadId:null,moveStartSequence:0,selectedLead:lead,Date,setTimeout,clearTimeout,
    byId:id=>id==='moveLeadPinBtn'?moveButton:id==='cancelLeadPinBtn'?cancelButton:null,
    leadById:id=>id===leadId?lead:null,mayMoveSelectedLead:()=>true,
    window:{MCCOY_SELECT_MAP_LEAD(){},MCCOY_MAP_VIEWPORT_LOCK:{acquire(){},release(){released++}}},
    menu:{classList:{remove(){}}},sync(){},restoreMountedWorkflow(){},showHint(text){hints.push(text)},
    sb:{functions:{async invoke(name,options){calls.push({name,body:options.body});return invoke(name,options)}}}
  });
  vm.runInContext(functions+'\n'+begin+'\n'+cancel,context);
  return {context,lead,starts,calls,hints,get released(){return released},async settle(){await new Promise(resolve=>setImmediate(resolve))}};
}

test('MOVE PIN automatically expands and waits for the authoritative snapshot before starting',async()=>{
  let resolve;const h=controller({invoke:()=>new Promise(r=>{resolve=r})});
  assert.equal(h.context.beginMovePin(leadId),true);assert.equal(h.context.expanded,true);
  assert.equal(h.starts.length,0);
  resolve({data:{ok:true,lead:snapshot},error:null});await h.settle();
  assert.equal(h.starts.length,1);assert.equal(h.starts[0].updatedAt,timestamp);
  assert.equal(h.starts[0].lat,snapshot.latitude);assert.equal(h.starts[0].lng,snapshot.longitude);
  assert.equal(h.calls[0].name,'lead-pin-snapshot');assert.equal(h.calls[0].body.lead_id,leadId);
});

test('cancel during snapshot loading prevents the delayed response from starting a move',async()=>{
  let resolve;const h=controller({invoke:()=>new Promise(r=>{resolve=r})});
  h.context.beginMovePin(leadId);h.context.cancelWorkflow();
  resolve({data:{ok:true,lead:snapshot},error:null});await h.settle();
  assert.equal(h.starts.length,0);assert.equal(h.lead.updatedAt,null);assert.equal(h.context.mode,'standard');
});

test('a cancelled request cannot overwrite a newer snapshot for the same lead',async()=>{
  const pending=[];const h=controller({invoke:()=>new Promise(resolve=>pending.push(resolve))});
  h.context.beginMovePin(leadId);h.context.cancelWorkflow();h.context.beginMovePin(leadId);
  pending[1]({data:{ok:true,lead:{...snapshot,latitude:11}},error:null});await h.settle();
  pending[0]({data:{ok:true,lead:snapshot},error:null});await h.settle();
  assert.equal(h.starts.length,1);assert.equal(h.lead.lat,11);
});

test('an unavailable or malformed snapshot blocks a move instead of bypassing concurrency checks',async()=>{
  for(const result of [{data:null,error:{message:'offline'}},{data:{ok:true,lead:{...snapshot,pin_location_updated_at:null}}},{data:{ok:true,lead:{...snapshot,id:'wrong-lead'}}},{data:{ok:true,lead:{...snapshot,latitude:NaN}}}]){
    const h=controller({invoke:async()=>result});h.context.beginMovePin(leadId);await h.settle();
    assert.equal(h.starts.length,0);assert.equal(h.context.movePinLeadId,null);assert.equal(h.context.mode,'standard');
    assert.ok(h.hints.includes('PIN REFRESH FAILED — TRY AGAIN'));
  }
});

test('snapshot capture preserves a missing database pin for a candidate-based correction',async()=>{
  const h=controller({invoke:async()=>({data:{ok:true,lead:{...snapshot,latitude:null,longitude:null}},error:null})});
  h.context.beginMovePin(leadId);await h.settle();assert.equal(h.starts[0].lat,null);assert.equal(h.starts[0].lng,null);
});

test('compact confirmation does not refresh or replace the original pin version after dragging',()=>{
  const handler=controls.split('\n').find(x=>x.includes("moveConfirm.addEventListener('click'"));
  assert.doesNotMatch(handler,/refreshMovePinSnapshot|lead-pin-snapshot/);
  assert.match(handler,/await underlying\.onclick\.call\(underlying,event\)/);
});

function endpoint({role='admin',assigned=true,user=true,active=true,found=true,rpcError=null}={}){
  const filters=[],tables=[],rpcCalls=[];let handler;
  const rows={app_user_access:{email:'fixture@example.invalid',role,active:true,organization_id:'fixture-org'},users:{id:'fixture-user'},leads:{...snapshot,assigned_rep_id:assigned?'fixture-user':'other-user',assigned_manager_id:assigned?'fixture-user':'other-user'}};
  const db={auth:{async getUser(){return {data:{user:user?{email:'fixture@example.invalid'}:null},error:null}}},async rpc(name,args){
    rpcCalls.push({name,args});return {data:found?rows.leads:null,error:rpcError};
  },from(table){
    tables.push(table);const query={select(){return query},eq(column,value){filters.push({table,column,value});return query},ilike(){return query},is(){return query},async maybeSingle(){return {data:table==='app_user_access'&&!active?null:rows[table],error:null}}};return query;
  }};
  const js=stripTypeScriptTypes(snapshotSource.replace(/^import .*\n/gm,'').replace("serveWithOrganizationAccess('lead_management',",'Deno.serve('));
  vm.runInNewContext(js,{createClient:()=>db,Deno:{env:{get:()=> 'fixture'},serve(fn){handler=fn}},Response,console:{error(){}}});
  return {filters,tables,rpcCalls,call:(method='POST',authorization='Bearer fixture')=>handler(new Request('https://example.invalid/lead-pin-snapshot',{method,headers:{...(authorization?{Authorization:authorization}:{}),'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({lead_id:leadId,organization_id:'untrusted-org'})}:{})}))};
}

test('snapshot endpoint has a working handler, CORS, and explicit method handling',async()=>{
  const h=endpoint();assert.equal((await h.call('OPTIONS')).status,200);assert.equal((await h.call('GET')).status,405);assert.equal(h.tables.length,0);
});

test('snapshot endpoint rejects missing credentials and inactive users before reading leads',async()=>{
  for(const options of [{user:false},{active:false}]){const h=endpoint(options);assert.ok([401,403].includes((await h.call()).status));assert.equal(h.rpcCalls.length,0);}
  assert.equal((await endpoint().call('POST','')).status,401);
});

test('snapshot response preserves precise coordinates and microseconds within the authorized organization',async()=>{
  const h=endpoint();const response=await h.call();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual((await response.json()).lead,snapshot);
  assert.equal(h.rpcCalls.length,1);
  assert.equal(h.rpcCalls[0].name,'get_lead_pin_snapshot');
  assert.equal(h.rpcCalls[0].args.p_lead_id,leadId);
  assert.equal(h.rpcCalls[0].args.p_organization_id,'fixture-org');
  assert.ok(!h.tables.includes('leads'),'must not fall back to the lossy table read');
});

test('missing leads and precision RPC failures cannot fall back to rounded coordinates',async()=>{
  for(const [options,status] of [[{found:false},404],[{rpcError:{message:'unavailable'}},500]]){
    const h=endpoint(options);assert.equal((await h.call()).status,status);
    assert.equal(h.rpcCalls.length,1);assert.ok(!h.tables.includes('leads'));
  }
});

test('snapshot endpoint is protected by the lead-management organization entitlement',()=>{
  assert.match(snapshotSource,/serveWithOrganizationAccess\('lead_management'/);
});

test('snapshot permission remains assignment scoped for field roles',async()=>{
  for(const role of ['rep','manager','trainer','tester']){
    assert.equal((await endpoint({role,assigned:true}).call()).status,200);
    assert.equal((await endpoint({role,assigned:false}).call()).status,403);
  }
  assert.equal((await endpoint({role:'unknown'}).call()).status,403);
});
