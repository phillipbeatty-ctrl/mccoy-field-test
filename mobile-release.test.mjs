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
const iconGenerator=await read('./scripts/generate-field-coach-icons.py');
const approvedSourceVerifier=await read('./scripts/verify-approved-logo-source.py');
const iconVerifier=await read('./scripts/verify-png-content.mjs');
const logoUsage=await read('./assets/brand/logo-usage.md');
const nativeBridge=await read('./mobile/mobile-native-bridge.js');
const androidWorkflow=await read('./.github/workflows/field-coach-android-internal.yml');
const releaseDoc=await read('./APP_RELEASE.md');

test('Capacitor 8 release toolchain is pinned and keeps the existing McCoy Platform bundle ID',()=>{
  assert.equal(packageJson.version,'1.0.0-beta.4');
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

test('approved JPEG and normalized PNG are immutable, checksum-gated source assets',()=>{
  assert.match(approvedSourceVerifier,/approved-upload-original\.jpg/);
  assert.match(approvedSourceVerifier,/official-logo-source\.png/);
  assert.match(approvedSourceVerifier,/227203e1c0ab14a1aa400e6f0d1411a6512222a685589df92dac3f3c1633cd90/);
  assert.match(approvedSourceVerifier,/ca00cdb16a50d463f9add9c15c4d193b038143f5e2b1cc4b86b9bc8cd4d787f5/);
  assert.match(approvedSourceVerifier,/ImageChops\.difference/);
  assert.match(logoUsage,/No redrawing, recoloring, vectorization, generative reconstruction/i);
  assert.match(logoUsage,/assets\/logo\.svg.*deprecated/is);
  assert.match(packageJson.scripts['icons:source:verify'],/verify-approved-logo-source\.py/);
});

test('PWA and native icon derivatives come only from the approved PNG without cropping',()=>{
  const icons=new Map(manifest.icons.map(icon=>[icon.src,icon]));
  assert.equal(icons.get('/assets/icon-192.png')?.sizes,'192x192');
  assert.equal(icons.get('/assets/icon-512.png')?.sizes,'512x512');
  assert.equal(icons.get('/assets/icon-maskable-512.png')?.purpose,'maskable');
  assert.match(iconGenerator,/brand.*official-logo-source\.png/s);
  assert.match(iconGenerator,/No crop, redraw, or recolor/);
  assert.match(iconGenerator,/icon-only\.png/);
  assert.match(iconGenerator,/icon-foreground\.png/);
  assert.match(iconGenerator,/apple-touch-icon-180\.png/);
  assert.doesNotMatch(iconGenerator,/logo\.svg|cairosvg|render_svg/i);
  assert.match(iconVerifier,/non_black_ratio/);
  assert.match(iconVerifier,/orange_ratio/);
  assert.match(iconVerifier,/light_ratio/);
  assert.match(iconVerifier,/color_buckets/);
});

test('store build uses bundled web assets rather than a remote production WebView',()=>{
  assert.equal(capacitorConfig.server?.url,undefined);
  assert.equal(capacitorConfig.server?.allowNavigation,undefined);
  assert.match(webBuilder,/mobile-web/);
  assert.match(webBuilder,/mobile-native-bridge\.js/);
  assert.match(webBuilder,/injectNativeBridge/);
  assert.match(webBuilder,/app_name:'Field Coach'/);
  assert.match(webBuilder,/1\.0\.0-beta\.4/);
  assert.match(releaseDoctor,/server\.url is not allowed/);
  assert.match(releaseDoctor,/allowNavigation is not allowed/);
  assert.match(releaseDoctor,/official-logo-source\.sha256/);
});

test('Android release enforces API 36, build 4, Field Coach label, foreground location, camera, and no cleartext traffic',()=>{
  assert.match(nativeConfigurator,/versionName='1\.0\.0-beta\.4'/);
  assert.match(nativeConfigurator,/versionCode='4'/);
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

test('iOS release config explicitly identifies the shell as Field Coach beta 4',()=>{
  assert.match(nativeConfigurator,/CFBundleDisplayName/);
  assert.match(nativeConfigurator,/CFBundleName/);
  assert.match(nativeConfigurator,/CURRENT_PROJECT_VERSION = 4/);
  assert.match(nativeConfigurator,/Field Coach uses your location/);
  assert.match(capacitorConfig.ios.appendUserAgent,/FieldCoachNative\/1\.0\.0-beta\.4/);
});

test('native bridge handles lifecycle without unattended reloads or polling',()=>{
  assert.match(nativeBridge,/mccoy-native-ready/);
  assert.match(nativeBridge,/appUrlOpen/);
  assert.match(nativeBridge,/backButton/);
  assert.match(nativeBridge,/navigator\.onLine/);
  assert.doesNotMatch(nativeBridge,/location\.reload/);
  assert.doesNotMatch(nativeBridge,/setInterval/);
});

test('Android CI verifies the approved source, checks launcher pixels, and publishes beta 4 only from the correction branch',()=>{
  assert.match(androidWorkflow,/actions\/checkout@v5/);
  assert.match(androidWorkflow,/actions\/setup-node@v5/);
  assert.match(androidWorkflow,/actions\/setup-java@v5/);
  assert.match(androidWorkflow,/android-actions\/setup-android@v4/);
  assert.match(androidWorkflow,/node-version:\s*['"]22['"]/);
  assert.match(androidWorkflow,/distribution:\s*['"]temurin['"]/);
  assert.match(androidWorkflow,/java-version:\s*['"]21['"]/);
  assert.match(androidWorkflow,/APP_VERSION: 1\.0\.0-beta\.4/);
  assert.match(androidWorkflow,/fix\/approved-official-logo-beta4-20260901/);
  assert.match(androidWorkflow,/icons:source:verify/);
  assert.match(androidWorkflow,/platforms;android-36/);
  assert.match(androidWorkflow,/build-tools;36\.0\.0/);
  assert.match(androidWorkflow,/assembleDebug/);
  assert.match(androidWorkflow,/bundleRelease/);
  assert.match(androidWorkflow,/verify-png-content\.mjs/);
  assert.match(androidWorkflow,/unzip -Z1/);
  assert.match(androidWorkflow,/unzip -p/);
  assert.match(androidWorkflow,/packaged_entries/);
  assert.ok(androidWorkflow.includes('ic_launcher(_foreground|_round)?\\.png'));
  assert.doesNotMatch(androidWorkflow,/ic_launcher_background/);
  assert.doesNotMatch(androidWorkflow,/-name 'ic_launcher\*\.png'/);
  assert.match(androidWorkflow,/downloads\/Field-Coach-Android-\$\{APP_VERSION\}-debug\.apk/);
  assert.match(androidWorkflow,/git add -f/);
  assert.match(androidWorkflow,/upload-artifact@v4/);
  assert.doesNotMatch(androidWorkflow,/McCoy-Android-/);
});

test('release documentation distinguishes approved-source beta 4 from a public store release',()=>{
  assert.match(releaseDoc,/1\.0\.0-beta\.4/);
  assert.match(releaseDoc,/approved uploaded artwork/i);
  assert.match(releaseDoc,/debug APK/i);
  assert.match(releaseDoc,/unsigned AAB/i);
  assert.match(releaseDoc,/not a public Play Store release/i);
  assert.match(releaseDoc,/Apple Developer/i);
});
