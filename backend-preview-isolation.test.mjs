import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,access,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {backendEnvironment,PRODUCTION_BACKEND_URL,PRODUCTION_PUBLIC_KEY,PRODUCTION_PROJECT_REF} from './scripts/backend-environment.mjs';
import {vercelConfig} from './scripts/vercel-config.mjs';
import {buildWeb} from './scripts/build-web.mjs';
import {adminDb} from './api/_lib.mjs';

const preview={VERCEL_ENV:'preview',VERCEL_URL:'mccoy-isolation-fixture.vercel.app',
  MCCOY_PREVIEW_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',
  MCCOY_PREVIEW_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test_fixture_public_key_0123456789',
  VERCEL_GIT_COMMIT_SHA:'fixture-commit'};
const clientFiles=['app-part1.js','confirm-email.js','pending-access.js','spotio-import.js'];
const runtimeFiles=[...clientFiles,'app-auth.js','app-auth-production-redirect.js','app-security.js',
  'service-worker.js','index.html','confirm-email.html','pending-access.html','spotio-import.html'];
async function fixture(t){
  const root=await mkdtemp(path.join(tmpdir(),'mccoy-backend-isolation-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  for(const file of runtimeFiles)await copyFile(new URL(file,import.meta.url),path.join(root,file));
  for(const dir of ['api','scripts','assets','downloads'])await mkdir(path.join(root,dir));
  await writeFile(path.join(root,'.env'),'MUST_NOT_SHIP=private');
  await writeFile(path.join(root,'api','secret.js'),'MUST_NOT_SHIP');
  await writeFile(path.join(root,'scripts','secret.js'),'MUST_NOT_SHIP');
  await writeFile(path.join(root,'test-private.js'),'MUST_NOT_SHIP');
  await writeFile(path.join(root,'package.json'),'{"private":true}');
  await writeFile(path.join(root,'downloads','production.apk'),Buffer.from([0,1,2,3]));
  await writeFile(path.join(root,'downloads','production.zip'),Buffer.from([3,2,1,0]));
  await copyFile(new URL('assets/icon-192.png',import.meta.url),path.join(root,'assets','icon-192.png'));
  return root;
}

test('missing or unknown deployment context cannot silently select production',()=>{
  for(const env of [{},{VERCEL_ENV:'staging'},{VERCEL_ENV:'PREVIEW'}]){
    assert.throws(()=>backendEnvironment(env),/deployment_environment_required/);
  }
  assert.throws(()=>backendEnvironment({VERCEL_ENV:'preview'}),/preview_backend_url_required/);
});

test('Preview rejects the production project and its public key independently',()=>{
  assert.throws(()=>backendEnvironment({...preview,MCCOY_PREVIEW_SUPABASE_URL:PRODUCTION_BACKEND_URL}),/production_backend/);
  assert.throws(()=>backendEnvironment({...preview,MCCOY_PREVIEW_SUPABASE_PUBLISHABLE_KEY:PRODUCTION_PUBLIC_KEY}),/production_key/);
});

test('Preview URL validation rejects credentials, paths, aliases and policy injection',()=>{
  for(const url of ['http://abcdefghijklmnopqrst.supabase.co','https://user@abcdefghijklmnopqrst.supabase.co',
    'https://abcdefghijklmnopqrst.supabase.co/','https://abcdefghijklmnopqrst.supabase.co.evil.test',
    "https://abcdefghijklmnopqrst.supabase.co; connect-src *",'https://custom.example.com']){
    assert.throws(()=>backendEnvironment({...preview,MCCOY_PREVIEW_SUPABASE_URL:url}),/preview_backend_url_required/);
  }
});

test('only a publishable key can enter a Preview browser bundle',()=>{
  for(const key of ['', 'sb_secret_private', 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature',
    "sb_publishable_valid_public_key_0123456789';alert(1)//"]){
    assert.throws(()=>backendEnvironment({...preview,MCCOY_PREVIEW_SUPABASE_PUBLISHABLE_KEY:key}),/preview_publishable_key_required/);
  }
});

test('Preview redirects require a deployment hostname and cannot target production',()=>{
  for(const hostname of ['', 'mccoy-field-test.vercel.app','www.mccoyplatform.com',
    'evil.test','test.vercel.app/path','test.vercel.app.evil.test','https://test.vercel.app']){
    assert.throws(()=>backendEnvironment({...preview,VERCEL_URL:hostname}),/preview_deployment_hostname_required/);
  }
});

test('production keeps its existing backend and rejects a conflicting server URL',()=>{
  const config=backendEnvironment({...preview,VERCEL_ENV:'production'});
  assert.equal(config.url,PRODUCTION_BACKEND_URL);
  assert.equal(config.publicKey,PRODUCTION_PUBLIC_KEY);
  assert.throws(()=>backendEnvironment({VERCEL_ENV:'production',SUPABASE_URL:preview.MCCOY_PREVIEW_SUPABASE_URL}),/production_backend_mismatch/);
});

test('CSP allows only the selected backend for HTTP and realtime while retaining other protections',()=>{
  const config=vercelConfig(preview);
  const headers=config.headers.find(row=>row.source==='/(.*)').headers;
  const csp=headers.find(header=>header.key==='Content-Security-Policy').value;
  assert.match(csp,/connect-src 'self' https:\/\/abcdefghijklmnopqrst\.supabase\.co wss:\/\/abcdefghijklmnopqrst\.supabase\.co;/);
  assert.match(csp,/img-src 'self' data: blob: https:\/\/abcdefghijklmnopqrst\.supabase\.co /);
  assert.doesNotMatch(csp,/athxxrfqxwlfnuvbqadp|https:\/\/\*\.supabase\.co|connect-src[^;]*\*/);
  assert.match(csp,/frame-ancestors 'none';/);
  assert.equal(headers.find(header=>header.key==='Cross-Origin-Opener-Policy').value,'same-origin-allow-popups');
  assert.equal(config.outputDirectory,'dist/web');
  assert.equal(config.buildCommand,'npm run build:web');
});

test('production headers remain identical to the reviewed baseline',async()=>{
  const original=JSON.parse(await readFile(new URL('./scripts/vercel-base.json',import.meta.url),'utf8'));
  assert.deepEqual(vercelConfig({VERCEL_ENV:'production'}).headers,original.headers);
});

test('all four actual browser entry points construct clients for the isolated backend',async t=>{
  const root=await fixture(t),result=await buildWeb({sourceRoot:root,env:preview});
  for(const file of clientFiles){
    const source=await readFile(path.join(result.output,file),'utf8');
    const calls=[],stop=new Error('client intercepted before any requests');
    const context=vm.createContext({window:{supabase:{createClient(...args){calls.push(args);throw stop;}}}});
    assert.throws(()=>vm.runInContext(source,context),error=>error===stop,file);
    assert.equal(calls.length,1,file);
    assert.equal(calls[0][0],preview.MCCOY_PREVIEW_SUPABASE_URL,file);
    assert.equal(calls[0][1],preview.MCCOY_PREVIEW_SUPABASE_PUBLISHABLE_KEY,file);
  }
});

test('signup, password recovery, and update links stay on the exact Preview',async t=>{
  const root=await fixture(t),result=await buildWeb({sourceRoot:root,env:preview});
  for(const file of ['app-auth.js','app-auth-production-redirect.js','app-security.js']){
    const emitted=await readFile(path.join(result.output,file),'utf8');
    assert.ok(emitted.includes('https://mccoy-isolation-fixture.vercel.app/'),file);
    assert.doesNotMatch(emitted,/mccoy-field-test\.vercel\.app|www\.mccoyplatform\.com|athxxrfqxwlfnuvbqadp/,file);
    assert.equal(await readFile(path.join(root,file),'utf8'),await readFile(new URL(file,import.meta.url),'utf8'));
  }
});

test('Preview output excludes private source and production downloadable bundles',async t=>{
  const root=await fixture(t),result=await buildWeb({sourceRoot:root,env:preview});
  for(const file of ['.env','api/secret.js','scripts/secret.js','test-private.js','package.json',
    'downloads/production.apk','downloads/production.zip']){
    await assert.rejects(access(path.join(result.output,file)),{code:'ENOENT'});
  }
  assert.deepEqual(await readFile(path.join(result.output,'assets/icon-192.png')),await readFile(new URL('assets/icon-192.png',import.meta.url)));
  const metadata=JSON.parse(await readFile(path.join(result.output,'deployment-environment.json'),'utf8'));
  assert.equal(metadata.project_ref,'abcdefghijklmnopqrst');
  assert.equal(metadata.source_commit,'fixture-commit');
  assert.ok(!JSON.stringify(metadata).includes(preview.MCCOY_PREVIEW_SUPABASE_PUBLISHABLE_KEY));
});

test('Preview cache identity changes when the backend changes without modifying source assets',async t=>{
  const root=await fixture(t);
  const first=await buildWeb({sourceRoot:root,env:preview});
  const firstWorker=await readFile(path.join(first.output,'service-worker.js'),'utf8');
  const second=await buildWeb({sourceRoot:root,env:{...preview,MCCOY_PREVIEW_SUPABASE_URL:'https://qrstabcdefghijklmnop.supabase.co'}});
  const secondWorker=await readFile(path.join(second.output,'service-worker.js'),'utf8');
  assert.notEqual(first.config_fingerprint,second.config_fingerprint);
  assert.notEqual(firstWorker,secondWorker);
  assert.match(firstWorker,/field-coach-app-shell-[^'\n]+-preview-[a-f0-9]{12}/);
  assert.equal(await readFile(path.join(root,'service-worker.js'),'utf8'),await readFile(new URL('service-worker.js',import.meta.url),'utf8'));
});

test('invalid Preview configuration removes an older production build',async t=>{
  const root=await fixture(t);
  await buildWeb({sourceRoot:root,env:{VERCEL_ENV:'production'}});
  await assert.rejects(buildWeb({sourceRoot:root,env:{VERCEL_ENV:'preview'}}),/preview_backend_url_required/);
  await assert.rejects(access(path.join(root,'dist/web')),{code:'ENOENT'});
});

test('production frontend output preserves runtime bytes and native download files',async t=>{
  const root=await fixture(t),result=await buildWeb({sourceRoot:root,env:{VERCEL_ENV:'production'}});
  for(const file of [...runtimeFiles,'downloads/production.apk','downloads/production.zip']){
    assert.deepEqual(await readFile(path.join(result.output,file)),await readFile(path.join(root,file)),file);
  }
});

test('a remaining production binding in a future runtime file fails the build',async t=>{
  const root=await fixture(t);
  await writeFile(path.join(root,'app-extra.js'),`const bypass='${PRODUCTION_PROJECT_REF}';`);
  await assert.rejects(buildWeb({sourceRoot:root,env:preview}),/production_reference_in_preview:app-extra.js/);
  await assert.rejects(access(path.join(root,'dist/web')),{code:'ENOENT'});
  await assert.rejects(access(path.join(root,'dist/.web-building')),{code:'ENOENT'});
});

test('Preview server APIs reject inherited credentials before making a client',()=>{
  const saved={VERCEL_ENV:process.env.VERCEL_ENV,SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY};
  try{
    process.env.SUPABASE_URL=PRODUCTION_BACKEND_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY='not-a-real-service-role-key';
    for(const value of ['preview','development','']){
      process.env.VERCEL_ENV=value;
      assert.throws(()=>adminDb(),/server_operations_disabled_outside_production/);
    }
  }finally{
    for(const [name,value] of Object.entries(saved)){
      if(value===undefined)delete process.env[name];else process.env[name]=value;
    }
  }
});
