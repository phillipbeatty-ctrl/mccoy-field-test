import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('production creation drift is reconciled against a frozen exact source, without deploying the pending paywall',()=>{
  const live=JSON.parse(read('./supabase/releases/gps-placement/live-creation-v6.json'));
  assert.equal(live.slug,'lead-field-actions');assert.equal(live.version,6);assert.equal(live.verify_jwt,true);
  assert.equal(live.ezbr_sha256,'46aea73ccac87076d996c4eb7c84509cfece09c1ce2ed663b9e24e8a5241f803');
  assert.equal(live.files.length,1);
  const source=read('./supabase/functions/lead-field-actions/index.ts');
  const withoutPendingWrapper=source.replace("import { serveWithOrganizationAccess } from '../_shared/organization-paywall.ts'\n",'')
    .replace("serveWithOrganizationAccess('lead_management',async request => {",'Deno.serve(async request => {');
  assert.equal(withoutPendingWrapper,live.files[0].content,'Unexpected source drift must be reconciled before release');
  const endpoint=read('./supabase/functions/lead-gps-placement/index.ts');
  assert.match(endpoint,/serveWithOrganizationAccess\('lead_management'/);
  assert.match(endpoint,/p_actor_auth_id: user.id, p_actor_email: user.email.toLowerCase\(\)/);
});
test('every changed GPS script is versioned and the nearest-lead pause remains intact',()=>{
  const html=read('./index.html'),loader=read('./app-page-layout.js'),worker=read('./service-worker.js');
  for(const name of ['app-gps-placement.js','app-part2.js','app-page-layout.js','app-field-lead-editor.js','app-lead-pool-independent-activity.js']){
    assert.ok((html+loader).includes(name+'?v=2026091107'),name+' must be loaded');
    assert.ok(worker.includes(name+'?v=2026091107'),name+' must be cached');
  }
  assert.match(read('./app-field-features.js'),/automaticNearestLead:false/);
});
