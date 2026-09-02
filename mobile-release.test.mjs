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
const androidContractWorkflow=await read('./.github/workflows/field-coach-android-internal.yml');
const beta5Workflow=await read('./.github/workflows/field-coach-android-beta5-sale-runtime.yml');
const releaseDoc=await read('./APP_RELEASE.md');

test('Capacitor 8 release toolchain is pinned and keeps the existing McCoy Platform bundle ID',()=>{
  assert.equal(packageJson.version,'1.0.0-beta.5');
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

test('the immutable approved PNG is the only required build-time brand source',()=>{
  assert.match(approvedSourceVerifier,/official-logo-source\.png/);
  assert.match(approvedSourceVerifier,/ca00cdb16a50d463f9add9c15c4d193b038143f5e2b1cc4b86b9bc8cd4d787f5/);
  assert.match(approvedSourceVerifier,/a07761316ddcbf77af92a7d6abbb2393ab1cde6ef251d0d39731788535a0279e/);
  assert.match(approvedSourceVerifier,/EXPECTED_SIZE = \(1024, 1024\)/);
  assert.match(approvedSourceVerifier,/EXPECTED_FORMAT = "PNG"/);
  assert.match(approvedSourceVerifier,/EXPECTED_MODE = "RGB"/);
  assert.match(approvedSourceVerifier,/original_upload_required_at_build_time/);
  assert.doesNotMatch(approvedSourceVerifier,/approved-upload-original\.jpg|ImageChops/);
  assert.match(logoUsage,/The JPEG is not required at build time/i);
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
  assert.match(webBuilder,/1\.0\.0-beta\.5/);
  assert.match(webBuilder,/app-supabase-client\.js/);
  assert.match(webBuilder,/app-sale-lifecycle\.js/);
  assert.match(webBuilder,/app-sale-photo-staging\.js/);
  assert.match(releaseDoctor,/server\.url is not allowed/);
  assert.match(releaseDoctor,/allowNavigation is not allowed/);
  assert.match(releaseDoctor,/official-logo-source\.sha256/);
  assert.match(releaseDoctor,/shared Supabase client resolver is missing/);
  assert.match(releaseDoctor,/repaired sale lifecycle is missing/);
  assert.match(releaseDoctor,/repaired photo staging is missing/);
});

test('Android release enforces API 36, build 5, Field Coach label, foreground location, camera, and no cleartext traffic',()=>{
  assert.match(nativeConfigurator,/versionName='1\.0\.0-beta\.5'/);
  assert.match(nativeConfigurator,/versionCode='5'/);
  assert.match(nativeConfigurator,/targetSdkVersion/);
  assert.match(nativeConfigurator,/Capacitor Android must target API 36/);
  assert.match(nativeConfigurator,/android\.permission\.ACCESS_COARSE_LOCATION/);
  assert.match(nativeConfigurator,/android\.permission\.ACCESS_FINE_LOCATION/);
  assert.match(nativeConfigurator,/android\.permission\.CAMERA/);
  assert.match(nativeConfigurator,/android:usesCleartextTraffic="false"/);
  assert.match(nativeConfigurator,/android:scheme="mccoy"/);
  assert.match(nativeConfigurator,/<string name="app_name">Field Coach<\/string>/);
  assert.match(beta5Workflow,/application-label:'Field Coach'/);
});

test('iOS release config explicitly identifies the shell as Field Coach beta 5',()=>{
  assert.match(nativeConfigurator,/CFBundleDisplayName/);
  assert.match(nativeConfigurator,/CFBundleName/);
  assert.match(nativeConfigurator,/CURRENT_PROJECT_VERSION = 5/);
  assert.match(nativeConfigurator,/Field Coach uses your location/);
  assert.match(capacitorConfig.ios.appendUserAgent,/FieldCoachNative\/1\.0\.0-beta\.5/);
});

test('native bridge handles lifecycle without unattended reloads or polling',()=>{
  assert.match(nativeBridge,/mccoy-native-ready/);
  assert.match(nativeBridge,/appUrlOpen/);
  assert.match(nativeBridge,/backButton/);
  assert.match(nativeBridge,/navigator\.onLine/);
  assert.doesNotMatch(nativeBridge,/location\.reload/);
  assert.doesNotMatch(nativeBridge,/setInterval/);
});

test('the existing Android workflow still supplies the pull-request compilation contract',()=>{
  assert.match(androidContractWorkflow,/pull_request:/);
  assert.match(androidContractWorkflow,/npm run test:mobile/);
  assert.match(androidContractWorkflow,/mobile:android:prepare/);
  assert.match(androidContractWorkflow,/assembleRelease/);
  assert.match(androidContractWorkflow,/bundleRelease/);
});

test('protected beta 5 workflow builds, signs, verifies, and publishes the repaired native package',()=>{
  assert.match(beta5Workflow,/name: Field Coach Android Beta 5 Sale Runtime/);
  assert.match(beta5Workflow,/actions\/checkout@v5/);
  assert.match(beta5Workflow,/actions\/setup-node@v5/);
  assert.match(beta5Workflow,/actions\/setup-java@v5/);
  assert.match(beta5Workflow,/android-actions\/setup-android@v4/);
  assert.match(beta5Workflow,/node-version:\s*['"]22['"]/);
  assert.match(beta5Workflow,/java-version:\s*['"]21['"]/);
  assert.match(beta5Workflow,/APP_VERSION: 1\.0\.0-beta\.5/);
  assert.match(beta5Workflow,/fix\/sale-completion-runtime-20260902/);
  assert.match(beta5Workflow,/environment: production/);
  assert.match(beta5Workflow,/get_field_coach_android_internal_signing_v1/);
  assert.match(beta5Workflow,/SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(beta5Workflow,/a3e8ca1f490053c2b38f1fc85c629fbefce2e8782e0dd4b03f55eb942f6df935/);
  assert.match(beta5Workflow,/icons:source:verify/);
  assert.match(beta5Workflow,/platforms;android-36/);
  assert.match(beta5Workflow,/build-tools;36\.0\.0/);
  assert.match(beta5Workflow,/assembleRelease/);
  assert.match(beta5Workflow,/bundleRelease/);
  assert.doesNotMatch(beta5Workflow,/assembleDebug/);
  assert.match(beta5Workflow,/apksigner[^\n]*sign/s);
  assert.match(beta5Workflow,/apksigner[^\n]*verify/s);
  assert.match(beta5Workflow,/jarsigner/);
  assert.match(beta5Workflow,/zipalign/);
  assert.match(beta5Workflow,/verify-png-content\.mjs/);
  assert.match(beta5Workflow,/app-supabase-client\.js/);
  assert.match(beta5Workflow,/app-sale-lifecycle\.js/);
  assert.match(beta5Workflow,/app-sale-photo-staging\.js/);
  assert.match(beta5Workflow,/versionCode='5'/);
  assert.match(beta5Workflow,/versionName='1\.0\.0-beta\.5'/);
  assert.match(beta5Workflow,/beta4_update_compatible/);
  assert.match(beta5Workflow,/clean_install_required_from_beta3/);
  assert.match(beta5Workflow,/downloads\/Field-Coach-Android-\$\{APP_VERSION\}-internal\.apk/);
  assert.match(beta5Workflow,/byte-identical compatibility alias/i);
  assert.match(beta5Workflow,/android-beta5-sale-runtime-generated/);
  assert.match(beta5Workflow,/git add -f/);
  assert.match(beta5Workflow,/upload-artifact@v4/);
  assert.doesNotMatch(beta5Workflow,/McCoy-Android-/);
});

test('release documentation describes beta 5, the persistent signer, and the beta 3 boundary',()=>{
  assert.match(releaseDoc,/1\.0\.0-beta\.5/);
  assert.match(releaseDoc,/approved uploaded artwork/i);
  assert.match(releaseDoc,/persistently signed internal APK/i);
  assert.match(releaseDoc,/Supabase Vault/i);
  assert.match(releaseDoc,/Beta 4 can update to beta 5 in place/i);
  assert.match(releaseDoc,/Beta 3 must be uninstalled/i);
  assert.match(releaseDoc,/not a public Play Store release/i);
  assert.match(releaseDoc,/Apple Developer/i);
});
