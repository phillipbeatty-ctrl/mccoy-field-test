import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const compat=await readFile(new URL('./spotio-import-compat.js',import.meta.url),'utf8');
const pendingFunction=await readFile(new URL('./supabase/functions/pending-account-access/index.ts',import.meta.url),'utf8');
const pendingPatch=await readFile(new URL('./app-pending-access-fix.js',import.meta.url),'utf8');
const pendingPage=await readFile(new URL('./pending-access.html',import.meta.url),'utf8');
const pendingController=await readFile(new URL('./pending-access.js',import.meta.url),'utf8');
const importPage=await readFile(new URL('./spotio-import.html',import.meta.url),'utf8');
const adminBootstrap=await readFile(new URL('./app-admin-lead-import.js',import.meta.url),'utf8');

class FakeResponse{
  constructor(body,{status=200,headers={}}={}){this.body=body;this.status=status;this.headers=headers;this.ok=status>=200&&status<300;}
  async json(){return JSON.parse(this.body||'{}');}
  clone(){return new FakeResponse(this.body,{status:this.status,headers:this.headers});}
}

function loadCompat(handler){
  const window={fetch:handler};
  vm.runInNewContext(compat,{window,Response:FakeResponse,JSON,Number,Math,String,Object,Array,Map,Date,console});
  return window;
}

test('current SPOTIO DOM rows are normalized to the real address before API matching',()=>{
  const window=loadCompat(async()=>new FakeResponse('{}'));
  const capture={
    source:'spotio_browser_capture',
    summary:{engine_version:'2.8.0',dom_rows:1,complete:true},
    dom_leads:[{
      name:'THADEUS BAKER',
      address:'Prospecting / Keep Knocking',
      zip:'76541',
      raw_cells:['','THADEUS BAKER','Prospecting / Keep Knocking','Aug 22, 2026 02:07 AM','Aug 30, 2026 04:59 PM','Sep 28, 2025 01:17 AM','JBJAMES BEATTY','SUSystem Update','JBJAMES BEATTY','api','Combo_Killeen TX 76541','1907 N 4TH ST , KILLEEN, TX 76541, US','76541','0','unknown']
    }]
  };
  const normalized=JSON.parse(window.MCCOY_SPOTIO_IMPORT_COMPAT.normalizeCaptureText(JSON.stringify(capture),'capture.json'));
  const row=normalized.dom_leads[0];
  assert.equal(row.address,'1907 N 4TH ST , KILLEEN, TX 76541');
  assert.equal(row.full_address,'1907 N 4TH ST , KILLEEN, TX 76541');
  assert.equal(row.state,'TX');
  assert.equal(row.zip,'76541');
  assert.equal(row.raw_cells[1],'THADEUS BAKER');
  assert.equal(row.raw_cells[2],'Prospecting / Keep Knocking');
  assert.equal(row.raw_cells[4],'1907 N 4TH ST , KILLEEN, TX 76541');
  assert.equal(row.raw_cells[8],'');
  assert.equal(row.raw_cells[10],'');
  assert.equal(row._mccoy_dom_schema_normalized,true);
});

test('incomplete SPOTIO capture is rejected before an import batch is created',async()=>{
  const calls=[];
  const window=loadCompat(async(input,init)=>{calls.push({input,init});return new FakeResponse('{}');});
  const response=await window.fetch('https://example.supabase.co/functions/v1/spotio-import',{
    method:'POST',
    body:JSON.stringify({
      action:'init',
      record_count:125,
      metadata:{summary:{complete:false,expected_leads:17627,dom_rows:125,api_unique_leads:175}}
    })
  });
  const body=await response.json();
  assert.equal(response.status,422);
  assert.equal(body.error,'incomplete_spotio_capture');
  assert.equal(body.expected,17627);
  assert.equal(body.captured,125);
  assert.equal(calls.length,0);
});

test('legacy normalize action is transparently converted to chunked normalization',async()=>{
  const actions=[];
  const handler=async(input,init)=>{
    const body=JSON.parse(init.body);actions.push(body.action);
    if(body.action==='prepare_normalization')return new FakeResponse(JSON.stringify({total:3,chunk_size:2}));
    if(body.action==='normalize_chunk')return new FakeResponse(JSON.stringify({processed:true,next_offset:Math.min(3,body.offset+body.limit)}));
    if(body.action==='complete_normalization')return new FakeResponse(JSON.stringify({complete:true,expected:3}));
    return new FakeResponse(JSON.stringify({error:'unexpected_action'}),{status:400});
  };
  const window=loadCompat(handler);
  const response=await window.fetch('https://example.supabase.co/functions/v1/spotio-import',{
    method:'POST',
    body:JSON.stringify({action:'normalize',batch_id:'00000000-0000-0000-0000-000000000000'})
  });
  assert.equal(response.status,200);
  assert.deepEqual(actions,['prepare_normalization','normalize_chunk','normalize_chunk','complete_normalization']);
});

test('pending access includes active accounts until email confirmation is complete',()=>{
  assert.match(pendingFunction,/emailConfirmedAt&&accessActive&&!requestPending/);
  assert.match(pendingFunction,/waiting_for_email_confirmation:!emailConfirmedAt/);
  assert.match(pendingFunction,/requires_access_grant:!accessActive/);
  assert.match(pendingFunction,/resend_confirmation/);
  assert.match(pendingFunction,/production_smtp_not_active/);
  assert.match(pendingPatch,/typeof sb!=='undefined'/);
  assert.match(pendingPatch,/ACCESS ALREADY GRANTED/);
  assert.match(pendingPatch,/pending-access\.html\?v=20260831\.4/);
});

test('Admin pending-access refresh is view-scoped, idempotent, and guarded',()=>{
  assert.match(pendingPatch,/function usersViewIsActive\(\)/);
  assert.match(pendingPatch,/classList\.contains\('active'\)===true/);
  assert.match(pendingPatch,/function setTextIfChanged\(/);
  assert.match(pendingPatch,/if\(element&&element\.textContent!==value\)element\.textContent=value/);
  assert.match(pendingPatch,/state\.refreshPromise/);
  assert.match(pendingPatch,/inFlightInvocations:new Map\(\)/);
  assert.match(pendingPatch,/state\.observer\.observe\(root,\{childList:true,subtree:true\}\)/);
  assert.doesNotMatch(pendingPatch,/observer\.observe\(document\.body/);
  assert.doesNotMatch(pendingPatch,/setInterval\(refreshVisibleAdminUsers,30000\)/);
  assert.doesNotMatch(pendingPatch,/window\.addEventListener\('focus',refreshVisibleAdminUsers\)/);
  assert.doesNotMatch(pendingPatch,/visibilitychange.*refreshVisibleAdminUsers/);
});

test('direct pending access page uses the authoritative endpoint without unattended refreshes',()=>{
  assert.match(pendingPage,/Pending Account Access/);
  assert.match(pendingPage,/pending-access\.js\?v=2026083105/);
  assert.match(pendingController,/pending-account-access/);
  assert.match(pendingController,/action:'list'/);
  assert.match(pendingController,/grant_pending_account_access/);
  assert.match(pendingController,/reset_user_password/);
  assert.match(pendingController,/waiting_for_email_confirmation/);
  assert.match(pendingController,/RESEND CONFIRMATION/);
  assert.match(pendingController,/production_ready/);
  assert.match(pendingController,/pendingLoadPromise/);
  assert.doesNotMatch(pendingController,/setInterval\(/);
  assert.doesNotMatch(pendingController,/addEventListener\('focus'/);
  assert.doesNotMatch(pendingController,/visibilitychange/);
});

test('production pages load the compatibility patches with fresh versions',()=>{
  assert.match(importPage,/spotio-import-compat\.js\?v=2026083102/);
  assert.match(importPage,/spotio-import\.js\?v=20260831-chunked-v2/);
  assert.match(adminBootstrap,/app-pending-access-fix\.js\?v=2026083104/);
});
