import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const bridge=await readFile(new URL('./native-entry.mjs',import.meta.url),'utf8');
const config=await readFile(new URL('../capacitor.config.ts',import.meta.url),'utf8');
const android=await readFile(new URL('../scripts/configure-native-location.mjs',import.meta.url),'utf8');

test('native shell is isolated and branded Field Coach by McCoy',()=>{
  assert.match(config,/appName: 'Field Coach'/);
  assert.match(config,/com\.mccoy\.fieldcoach'/);
  assert.doesNotMatch(config,/com\.mccoy\.fieldcoach\.dev/);
  assert.match(bridge,/Capacitor\.isNativePlatform\(\)/);
});

test('START and STOP session events own native tracking lifecycle',()=>{
  assert.match(bridge,/mccoy-field-session-started/);
  assert.match(bridge,/BackgroundGeolocation\.start/);
  assert.match(bridge,/mccoy-field-session-ended/);
  assert.match(bridge,/BackgroundGeolocation\.stop/);
  assert.match(bridge,/revoke_native_location_token/);
});

test('native POST path uses session-scoped token and no public service key',()=>{
  assert.match(bridge,/register_native_location_token/);
  assert.match(bridge,/native-location-ingest/);
  assert.match(bridge,/x-mccoy-location-token/);
  assert.doesNotMatch(bridge,/SERVICE_ROLE|service_role/i);
});

test('Android uses a foreground location service without requesting background geofence permission',()=>{
  assert.match(android,/FOREGROUND_SERVICE_LOCATION/);
  assert.match(android,/POST_NOTIFICATIONS/);
  assert.doesNotMatch(android,/ACCESS_BACKGROUND_LOCATION/);
});
