import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const detail=fs.readFileSync(new URL('./app-lead-detail-panel.js',import.meta.url),'utf8');
const map=fs.readFileSync(new URL('./app-lead-map.js',import.meta.url),'utf8');

test('clicking a Lead Pool map pin opens the shared disposition panel',()=>{
  assert.match(map,/mccoy-map-lead-selected/);
  assert.match(detail,/mapLeadActivityType/);
  assert.match(detail,/mapLeadVisitResult/);
  assert.match(detail,/mapLeadStage/);
  assert.match(detail,/mccoy-map-lead-selected/);
});

test('map dispositions reuse authoritative start and completion workflows',()=>{
  assert.match(detail,/MCCOY_START_DOOR_VISIT\?\.\(\{automatic:false\}\)/);
  assert.match(detail,/MCCOY_COMPLETE_DOOR_VISIT\?\.\('spotio'/);
  assert.match(detail,/same ownership, session, GPS, distance, and verified-sale rules as Sales Hub/);
  assert.doesNotMatch(detail,/sb\.from\(['"]leads['"]\)\.update/);
});

test('Sale Made from a map pin routes to verified sale processing',()=>{
  assert.match(detail,/if\(stage==='Sale Made'\)\{sale\.click\(\);return;\}/);
  assert.match(detail,/document\.getElementById\('processSaleBtn'\)\?\.click\(\)/);
});
