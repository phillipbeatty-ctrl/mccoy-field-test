import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const revision='2026091301';
const cache='field-coach-app-shell-v28-20260913-photo-recovery';
const assets=['app-sales.js','app-sale-photo-staging.js','app-provider-sale-router.js','app-sale-lifecycle.js','app-page-layout.js'];

test('Sale choices scripts use the same release revision in the page and service worker',()=>{
  for(const file of ['index.html','service-worker.js'])for(const asset of assets)assert.ok(read(file).includes(`${asset}?v=${revision}`),`${file} must use current ${asset}`);
  assert.ok(read('app-page-layout.js').includes(`app-sale-photo-staging.js?v=${revision}`));
});

test('the screenshot recovery cache is distinct from every earlier candidate',()=>{
  assert.ok(read('service-worker.js').startsWith(`const VERSION='${cache}';`));
  assert.ok(!read('service-worker.js').includes('field-coach-app-shell-v25-'));
});

test('native builders require the current screenshot asset revision',()=>{
  for(const file of ['scripts/build-mobile-web.mjs','scripts/mobile-release-doctor.mjs'])assert.ok(read(file).includes(`app-sale-photo-staging.js?v=${revision}`),file);
});

test('both unsigned and signed Android paths check the new cache',()=>{
  const workflow=read('.github/workflows/field-coach-android-beta5-sale-runtime.yml');
  assert.equal(workflow.split(cache).length-1,2);
  assert.ok(workflow.includes(`app-sale-photo-staging.js?v=${revision}`));
});

test('PR checks execute the browser regressions and release contract using the lockfile',()=>{
  const workflow=read('.github/workflows/sale-photo-return.yml');
  assert.ok(workflow.includes('pull_request:'));
  assert.ok(workflow.includes('npm ci --ignore-scripts'));
  assert.ok(workflow.includes('provider-return-outcomes.test.mjs'));
  assert.ok(workflow.includes('sale-photo-return-release.test.mjs'));
  assert.ok(!/pull_request_target|secrets\./.test(workflow));
});
