import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const packageJson=JSON.parse(await read('./package.json'));
const capacitorConfig=JSON.parse(await read('./capacitor.config.json'));
const manifest=JSON.parse(await read('./manifest.webmanifest'));
const webBuilder=await read('./scripts/build-mobile-web.mjs');
const nativeConfigurator=await read('./scripts/configure-native-project.mjs');
const releaseDoctor=await read('./scripts/mobile-release-doctor.mjs');
const nativeBridge=await read('./mobile/mobile-native-bridge.js');
const androidWorkflow=await read('./.github/workflows/field-coach-android-internal.yml');
const releaseDoc=await read('./APP_RELEASE.md');

test('Capacitor 8 release toolchain is pinned and keeps the existing McCoy Platform bundle ID',()=>{
  assert.equal(packageJson.version,'1.0.0-beta.2');
  assert.equal(packageJson.engines.node,'>=22');
  assert.equal(packageJson.dependencies['@capacitor/core'],'8.5.0');
  assert.equal(packageJson.dependencies['@capacitor/android'],'8.5.0');
  assert.equal(packageJson.dependencies['@capacitor/ios'],'8.5.0');
  assert.equal(packageJson.devDependencies['@capacitor/cli'],'8.5.0');
  assert.equal(capacitorConfig.appId,'com.mccoyplatform.app');
  assert.equal(capacitorConfig.appName,'Field Coach');
  assert.equal(capacitorConfig.webDir,'mobile-web');
  assert.equal(manifest.name,'Field Coach');
  assert.equal(manifest.short_name,'Field Coach');
});

test('store build uses bundled web assets rather than a remote production WebView',()=>{
  assert.equal(capacitorConfig.server?.url,undefined);
  assert.equal(capacitorConfig.server?.allowNavigation,undefined);
  assert.match(webBuilder,/mobile-web/);
  assert.match(webBuilder,/mobile-native-bridge\.js/);
  assert.match(webBuilder,/injectNativeBridge/);
  assert.match(webBuilder,/app_name:'Field Coach'/);
  assert.match(releaseDoctor,/server\.url is not allowed/);
  assert.match(releaseDoctor,/allowNavigation is not allowed/);
});

test('Android release enforces API 36, Field Coach label, foreground location, camera, and no cleartext traffic',()=>{
  assert.match(nativeConfigurator,/targetSdkVersion/);
  assert.match(nativeConfigurator,/Capacitor Android must target API 36/);
  assert.match(nativeConfigurator,/android\.permission\.ACCESS_COARSE_LOCATION/);
  assert.match(nativeConfigurator,/android\.permission\.ACCESS_FINE_LOCATION/);
  assert.match(nativeConfigurator,/android\.permission\.CAMERA/);
  assert.match(nativeConfigurator,/android:usesCleartextTraffic="false"/);
  assert.match(nativeConfigurator,/android:scheme="mccoy"/);
  assert.match(nativeConfigurator,/<string name="app_name">Field Coach<\/string>/);
  assert.match(androidWorkflow,/application-label:'Field Coach'/);
});

test('iOS release config explicitly identifies the shell as Field Coach',()=>{
  assert.match(nativeConfigurator,/CFBundleDisplayName/);
  assert.match(nativeConfigurator,/CFBundleName/);
  assert.match(nativeConfigurator,/Field Coach uses your location/);
  assert.match(capacitorConfig.ios.appendUserAgent,/FieldCoachNative\/1\.0\.0-beta\.2/);
});

test('native bridge handles lifecycle without unattended reloads or polling',()=>{
  assert.match(nativeBridge,/mccoy-native-ready/);
  assert.match(nativeBridge,/appUrlOpen/);
  assert.match(nativeBridge,/backButton/);
  assert.match(nativeBridge,/navigator\.onLine/);
  assert.doesNotMatch(nativeBridge,/location\.reload/);
  assert.doesNotMatch(nativeBridge,/setInterval/);
});

test('Android CI builds an installable Field Coach debug APK and unsigned release AAB',()=>{
  assert.match(androidWorkflow,/actions\/checkout@v5/);
  assert.match(androidWorkflow,/actions\/setup-node@v5/);
  assert.match(androidWorkflow,/actions\/setup-java@v5/);
  assert.match(androidWorkflow,/android-actions\/setup-android@v4/);
  assert.match(androidWorkflow,/node-version:\s*['"]22['"]/);
  assert.match(androidWorkflow,/distribution:\s*['"]temurin['"]/);
  assert.match(androidWorkflow,/java-version:\s*['"]21['"]/);
  assert.match(androidWorkflow,/platforms;android-36/);
  assert.match(androidWorkflow,/build-tools;36\.0\.0/);
  assert.match(androidWorkflow,/assembleDebug/);
  assert.match(androidWorkflow,/bundleRelease/);
  assert.match(androidWorkflow,/upload-artifact@v4/);
  assert.match(androidWorkflow,/Field-Coach-Android-\$\{APP_VERSION\}-debug\.apk/);
  assert.match(androidWorkflow,/Field-Coach-Android-\$\{APP_VERSION\}-unsigned\.aab/);
  assert.doesNotMatch(androidWorkflow,/McCoy-Android-/);
});

test('release documentation distinguishes internal beta from store release',()=>{
  assert.match(releaseDoc,/1\.0\.0-beta\.2/);
  assert.match(releaseDoc,/Field Coach/i);
  assert.match(releaseDoc,/debug APK/i);
  assert.match(releaseDoc,/unsigned AAB/i);
  assert.match(releaseDoc,/not a public Play Store release/i);
  assert.match(releaseDoc,/Apple Developer/i);
});
