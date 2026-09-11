import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const styles=fs.readFileSync(new URL('./styles.css',import.meta.url),'utf8');
const layout=fs.readFileSync(new URL('./app-lead-pool-layout.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');

test('map assignment occupies the full desktop right column from the first row',()=>{
  assert.match(styles,/#leads>\.card\.lead-pool-map-workspace\{[\s\S]*grid-template-columns:minmax\(0,1fr\) clamp\(330px,30vw,440px\)/);
  assert.match(styles,/#leadMapPanel:not\(\.lead-map-window-expanded\)>\.grid-2>\.card:last-child\{[\s\S]*grid-column:2;[\s\S]*grid-row:1\/6/);
  assert.match(styles,/max-width:none!important;[\s\S]*height:100%/);
});

test('lead list is bounded while selected-lead disposition receives remaining space',()=>{
  assert.match(styles,/#mapLeadList\{[\s\S]*flex:0 1 18vh!important;[\s\S]*max-height:170px!important/);
  assert.match(styles,/#mapLeadDetail\{[\s\S]*flex:1 1 auto;[\s\S]*min-height:180px;[\s\S]*max-height:none/);
});

test('filters remain ordered and the search is deliberately shortened',()=>{
  const team=styles.indexOf('.toolbar #teamFilter{flex:0 1 140px');
  const owner=styles.indexOf('.toolbar #leadOwnerFilter{flex:0 1 155px');
  const search=styles.indexOf('.toolbar #leadSearch{flex:0 1 210px');
  assert.ok(team>=0&&owner>team&&search>owner);
});

test('demo creation moves left and map/list mode toggles the workspace safely',()=>{
  assert.match(layout,/modeBar\.insertBefore\(demoButton,modeBar\.firstElementChild\)/);
  assert.match(layout,/shell\.classList\.toggle\('lead-pool-map-workspace',mapVisible\)/);
  assert.match(layout,/\[data-view="leads"\],#leadMapView,#leadListView/);
  assert.match(layout,/lead-map-expanded>[\s\S]*card:nth-child\(2\)\{display:none!important\}/);
});

test('Lead Pool hides the server-control badge and cache-busts layout assets',()=>{
  assert.match(styles,/body:has\(#leads\.view\.active\) #modeBadge\{display:none\}/);
  assert.match(html,/styles\.css\?v=2026091102/);
  assert.match(html,/app-lead-pool-layout\.js\?v=2026082424/);
});

test('wide-screen grid flattening cannot override the maximized map box',()=>{
  const flatten=styles.match(/([^{}]+)\{display:contents!important\}/)[1];
  for(const selector of flatten.split(',')) assert.match(selector,/#leadMapPanel:not\(\.lead-map-window-expanded\)/);
  assert.doesNotMatch(styles,/#leadMapPanel>\.grid-2\{display:contents!important\}/);
});
