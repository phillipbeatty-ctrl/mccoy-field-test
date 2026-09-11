import test from 'node:test';
import assert from 'node:assert/strict';
import {ui,loadAddress,read} from './test-support/ui-dom.mjs';

test('production loads one Sales Hub layout controller',()=>{
  const loader=read('app-page-layout.js');assert.equal((loader.match(/app-sales-hub-layout\.js/g)||[]).length,1);assert.doesNotMatch(loader,/app-sales-hub-(?:fieldcoach-workday|production)-layout\.js/);
});

test('a cached legacy layout script cannot start a second controller',()=>{
  const h=ui(),input=loadAddress(h);h.load('app-sales-hub-layout.js');h.clock.flush();input.focus();
  h.load('app-sales-hub-fieldcoach-workday-layout.js');assert.equal(h.clock.pending.size,0);assert.equal(h.document.activeElement,input);h.close();
});
