import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const json=async path=>JSON.parse(await read(path));

const manifest=await json('./manifest.webmanifest');
const capacitor=await json('./capacitor.config.json');
const packageJson=await json('./package.json');
const branding=await read('./app-branding.js');
const pageLayout=await read('./app-page-layout.js');
const installer=await read('./install.html');
const confirmation=await read('./confirm-email.html');
const confirmationController=await read('./confirm-email.js');
const pending=await read('./pending-access.html');
const pendingController=await read('./pending-access.js');
const importer=await read('./spotio-import.html');
const offline=await read('./offline.html');
const fieldRoute=await read('./field-coach.html');
const salesRoute=await read('./sales-hub.html');
const icon=await read('./field-coach-app-icon.svg');
const legacyIcon=await read('./mccoy-app-icon.svg');
const nativeConfigurator=await read('./scripts/configure-native-project.mjs');
const authBrandUpdater=await read('./scripts/apply-field-coach-auth-brand.mjs');
const activationWorkflow=await read('./.github/workflows/configure-production-auth-email.yml');
const serviceWorker=await read('./service-worker.js');

const forbiddenVisibleBrand=/(McCoy Platform(?! LLC)|McCoy Field Coach|Install McCoy|OPEN MCCOY|BACK TO MCCOY|CONTINUE TO MCCOY|McCoy Lead Import|McCoy Pending Account Access)/;

test('PWA and native launchers are named Field Coach',()=>{
  assert.equal(manifest.name,'Field Coach');
  assert.equal(manifest.short_name,'Field Coach');
  assert.equal(manifest.icons[0].src,'/field-coach-app-icon.svg');
  assert.equal(capacitor.appName,'Field Coach');
  assert.equal(capacitor.appId,'com.mccoyplatform.app');
  assert.equal(packageJson.name,'field-coach-app');
  assert.equal(packageJson.version,'1.0.0-beta.2');
});

test('public standalone pages use Field Coach branding',()=>{
  for(const [name,source] of Object.entries({installer,confirmation,pending,importer,offline,fieldRoute,salesRoute})){
    assert.doesNotMatch(source,forbiddenVisibleBrand,`${name} still exposes the previous product name`);
    assert.match(source,/Field Coach/,`${name} does not identify Field Coach`);
  }
  assert.match(confirmationController,/Continue to Field Coach/);
  assert.match(pendingController,/Field Coach Admin/);
});

test('production application loads the idempotent branding controller',()=>{
  assert.match(pageLayout,/app-branding\.js\?v=2026083101/);
  assert.match(branding,/PRODUCT_NAME='Field Coach'/);
  assert.match(branding,/LEGAL_NAME='McCoy Platform LLC'/);
  assert.match(branding,/observer\.disconnect\(\)/);
  assert.match(branding,/if\(next!==node\.data\)node\.data=next/);
  assert.doesNotMatch(branding,/setInterval/);
  assert.doesNotMatch(branding,/location\.reload/);
});

test('Field Coach icon replaces the old M artwork while retaining a compatibility alias',()=>{
  assert.match(icon,/aria-label="Field Coach"/);
  assert.match(legacyIcon,/aria-label="Field Coach"/);
  assert.doesNotMatch(icon,/aria-label="McCoy"/);
  assert.doesNotMatch(icon,/M95 364V148/);
});

test('Android, iPhone, and iPad generated projects explicitly receive Field Coach',()=>{
  assert.match(nativeConfigurator,/const productName='Field Coach'/);
  assert.match(nativeConfigurator,/app_name/);
  assert.match(nativeConfigurator,/title_activity_main/);
  assert.match(nativeConfigurator,/CFBundleDisplayName/);
  assert.match(nativeConfigurator,/Field Coach uses your location/);
});

test('Auth sender and confirmation template are permanently reasserted as Field Coach',()=>{
  assert.match(authBrandUpdater,/PRODUCT_NAME='Field Coach'/);
  assert.match(authBrandUpdater,/Confirm your Field Coach email address/);
  assert.match(authBrandUpdater,/confirmation_emails_sent:0/);
  assert.match(activationWorkflow,/default: Field Coach/);
  assert.match(activationWorkflow,/apply-field-coach-auth-brand\.mjs/);
});

test('service worker advances the Field Coach shell and caches the new icon',()=>{
  assert.match(serviceWorker,/field-coach-app-shell/);
  assert.match(serviceWorker,/field-coach-app-icon\.svg/);
  assert.match(serviceWorker,/app-branding\.js/);
});
