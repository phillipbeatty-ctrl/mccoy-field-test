import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const ipadLayout=await readFile(new URL('../app-ipad-layout.js',import.meta.url),'utf8');
const prepare=await readFile(new URL('../scripts/prepare-mobile-web.mjs',import.meta.url),'utf8');
const nativeConfig=await readFile(new URL('../scripts/configure-native-location.mjs',import.meta.url),'utf8');
const workflow=await readFile(new URL('../.github/workflows/mobile-ios-dev.yml',import.meta.url),'utf8');

test('mobile bundle injects iPad-only responsive layout support',()=>{
  assert.match(prepare,/app-ipad-layout\.js/);
  assert.match(ipadLayout,/field-coach-ipad-wide/);
  assert.match(ipadLayout,/#leadMapPanel\.lead-map-expanded/);
  assert.match(ipadLayout,/#mapLeadDetail/);
  assert.match(ipadLayout,/removeAttribute\('inert'\)/);
});

test('generated iOS target is explicitly universal iPhone and iPad',()=>{
  assert.match(nativeConfig,/TARGETED_DEVICE_FAMILY/);
  assert.match(nativeConfig,/1,2/);
  assert.match(nativeConfig,/UISupportedInterfaceOrientations~ipad/);
});

test('CI contains separate iPhone and iPad simulator jobs',()=>{
  assert.match(workflow,/family:\s*\[iphone, ipad\]/);
  assert.match(workflow,/DEVICE_FAMILY/);
  assert.match(workflow,/xcrun simctl/);
  assert.match(workflow,/platform=iOS Simulator,id=/);
});
