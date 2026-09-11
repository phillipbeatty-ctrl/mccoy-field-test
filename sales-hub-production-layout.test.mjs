import test from 'node:test';
import assert from 'node:assert/strict';
import {ui,loadAddress,read} from './test-support/ui-dom.mjs';

function addCard(h,id){const card=h.document.createElement('section');card.id=id;card.className='card';h.document.getElementById('field').appendChild(card);return card;}
function layout(){const h=ui();loadAddress(h);addCard(h,'sphWorkdayControl');addCard(h,'payProgressCard');h.load('app-sales-hub-layout.js');h.clock.flush();return h;}

test('Sales Hub mounts the approved card order and puts Field Coach below it',()=>{
  const h=layout();assert.deepEqual([...h.document.getElementById('salesHubLeftStack').children].map(node=>node.id),['sessionCard','sphWorkdayControl','statsCard','payProgressCard']);
  const top=h.document.getElementById('salesHubTopGrid');assert.deepEqual([...top.children].map(node=>node.id),['salesHubLeftStack','doorCard']);assert.equal(top.nextElementSibling.id,'coachMetrics');h.close();
});

for(const target of ['fieldLeadAddressInput','sessionIsp'])test(`${target} retains focus and its value through repeated layout events`,()=>{
  const h=layout(),input=h.document.getElementById(target);input.focus();input.value=target==='sessionIsp'?'Fidium':'123 Main St';if(target!=='sessionIsp')input.setSelectionRange(2,6);
  for(let i=0;i<20;i++)for(const name of ['mccoy-access-ready','mccoy-sale-saved','mccoy-sph-workday-ready','mccoy-background-mode-changed'])h.emit(name);
  assert.equal(h.clock.pending.size,1);h.clock.flush();
  assert.equal(h.document.getElementById(target),input);assert.equal(h.document.activeElement,input);assert.equal(input.value,target==='sessionIsp'?'Fidium':'123 Main St');if(target!=='sessionIsp'){assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,6);}
  assert.equal(h.clock.pending.size,0);h.close();
});

test('late Workday and Pay cards are inserted without detaching an active address field',()=>{
  const h=ui(),input=loadAddress(h);h.load('app-sales-hub-layout.js');h.clock.flush();input.focus();h.type(input,'New address');
  addCard(h,'sphWorkdayControl');addCard(h,'payProgressCard');h.emit('mccoy-sph-workday-ready');h.clock.flush();
  assert.equal(h.document.activeElement,input);assert.equal(input.value,'New address');assert.deepEqual([...h.document.getElementById('salesHubLeftStack').children].map(node=>node.id),['sessionCard','sphWorkdayControl','statsCard','payProgressCard']);h.close();
});

test('the single controller retains the approved responsive columns and compact metrics',()=>{
  const source=read('app-sales-hub-layout.js');assert.match(source,/grid-template-areas:"left door"!important/);assert.match(source,/@media\(max-width:980px\)/);assert.match(source,/grid-template-areas:"left" "door"!important/);assert.match(source,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)!important/);
});
