import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const compat=await readFile(new URL('./spotio-import-compat.js',import.meta.url),'utf8');
const pendingFunction=await readFile(new URL('./supabase/functions/pending-account-access/index.ts',import.meta.url),'utf8');
const pendingPatch=await readFile(new URL('./app-pending-access-fix.js',import.meta.url),'utf8');
const importPage=await readFile(new URL('./spotio-import.html',import.meta.url),'utf8');
const pageLayout=await readFile(new URL('./app-page-layout.js',import.meta.url),'utf8');

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
  assert.match(pendingPatch,/ACCESS ALREADY GRANTED/);
  assert.match(pendingPatch,/action:'reset_user_password'/);
  assert.match(pendingPatch,/setInterval\(refreshVisibleAdminUsers,30000\)/);
});

test('production pages load the compatibility patches with fresh versions',()=>{
  assert.match(importPage,/spotio-import-compat\.js\?v=2026083101/);
  assert.match(importPage,/spotio-import\.js\?v=20260831-chunked-v2/);
  assert.match(pageLayout,/app-pending-access-fix\.js\?v=2026083101/);
});
