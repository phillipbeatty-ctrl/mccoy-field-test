#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=relativePath=>readFile(path.join(root,relativePath),'utf8');
const failures=[];
const checks=[];

function check(name,condition,detail){
  checks.push({name,ok:Boolean(condition),detail});
  if(!condition)failures.push(`${name}: ${detail}`);
}

const packageJson=JSON.parse(await read('package.json'));
const capacitorConfig=JSON.parse(await read('capacitor.config.json'));
const manifest=JSON.parse(await read('manifest.webmanifest'));
const mobileIndex=await read('mobile-web/index.html').catch(()=>null);
const mobileBridge=await read('mobile-web/mobile-native-bridge.js').catch(()=>null);
const mobileMetadata=JSON.parse(await read('mobile-web/mobile-build.json').catch(()=>'{"missing":true}'));
const approvedChecksum=await read('assets/brand/official-logo-source.sha256').catch(()=>null);
const manifestIcons=new Map((manifest.icons||[]).map(icon=>[icon.src,icon]));

check('package version',packageJson.version==='1.0.0-beta.5',`expected 1.0.0-beta.5, received ${packageJson.version}`);
check('Capacitor 8 core',packageJson.dependencies?.['@capacitor/core']==='8.5.0','@capacitor/core must be pinned to 8.5.0');
check('Android platform',packageJson.dependencies?.['@capacitor/android']==='8.5.0','@capacitor/android must be pinned to 8.5.0');
check('iOS platform',packageJson.dependencies?.['@capacitor/ios']==='8.5.0','@capacitor/ios must be pinned to 8.5.0');
check('bundle identifier',capacitorConfig.appId==='com.mccoyplatform.app','Capacitor appId mismatch');
check('native display name',capacitorConfig.appName==='Field Coach',`expected Field Coach, received ${capacitorConfig.appName}`);
check('approved logo checksum',approvedChecksum?.trim()==='ca00cdb16a50d463f9add9c15c4d193b038143f5e2b1cc4b86b9bc8cd4d787f5  assets/brand/official-logo-source.png','approved logo checksum file is missing or incorrect');
check('PWA display name',manifest.name==='Field Coach'&&manifest.short_name==='Field Coach','manifest must identify the installed app as Field Coach');
check('PWA 192 icon',manifestIcons.get('/assets/icon-192.png')?.sizes==='192x192','manifest must include the 192x192 PNG icon');
check('PWA 512 icon',manifestIcons.get('/assets/icon-512.png')?.sizes==='512x512','manifest must include the 512x512 PNG icon');
check('PWA maskable icon',manifestIcons.get('/assets/icon-maskable-512.png')?.purpose==='maskable','manifest must include a separate maskable PNG icon');
check('bundled production assets',capacitorConfig.webDir==='mobile-web','Capacitor webDir must be mobile-web');
check('no remote production WebView',!capacitorConfig.server?.url,'server.url is not allowed for a production store build');
check('no production navigation allowlist',!capacitorConfig.server?.allowNavigation,'allowNavigation is not allowed for this production wrapper');
check('local mobile index',Boolean(mobileIndex),'mobile-web/index.html is missing');
check('native bridge bundled',Boolean(mobileBridge&&mobileIndex?.includes('mobile-native-bridge.js?v=1.0.0-beta.5')),'beta 5 native bridge was not injected into the bundled index');
check('sale client bundled',Boolean(mobileIndex?.includes('app-supabase-client.js?v=2026090201')),'shared Supabase client resolver is missing from the native bundle');
check('sale lifecycle bundled',Boolean(mobileIndex?.includes('app-sale-lifecycle.js?v=2026091301')),'repaired sale lifecycle is missing from the native bundle');
check('sale photo staging bundled',Boolean(mobileIndex?.includes('app-sale-photo-staging.js?v=2026091301')),'repaired photo staging is missing from the native bundle');
for(const asset of ['app-sales.js','app-provider-sale-router.js'])check(`${asset} bundled`,Boolean(mobileIndex?.includes(`${asset}?v=2026091301`)),`current provider return asset ${asset} is missing from the native bundle`);
check('build metadata',mobileMetadata.app_id==='com.mccoyplatform.app','mobile build metadata is missing or incorrect');
check('build display name',mobileMetadata.app_name==='Field Coach','mobile build metadata must use Field Coach');
check('build version',mobileMetadata.version==='1.0.0-beta.5','mobile build metadata must use beta 5');

let productionStatus=null;
let confirmationStatus=null;
try{
  const response=await fetch('https://www.mccoyplatform.com/',{redirect:'manual'});
  productionStatus=response.status;
  check('production origin',response.status===200,`https://www.mccoyplatform.com returned ${response.status}`);
}catch(error){
  check('production origin',false,error.message);
}
try{
  const response=await fetch('https://www.mccoyplatform.com/confirm-email.html?mobile-release-check=1',{redirect:'manual'});
  confirmationStatus=response.status;
  check('confirmation route',response.status===200,`confirmation route returned ${response.status}`);
}catch(error){
  check('confirmation route',false,error.message);
}

const report={
  ok:failures.length===0,
  version:packageJson.version,
  app_id:'com.mccoyplatform.app',
  app_name:'Field Coach',
  approved_logo_source:'assets/brand/official-logo-source.png',
  approved_logo_sha256:'ca00cdb16a50d463f9add9c15c4d193b038143f5e2b1cc4b86b9bc8cd4d787f5',
  source_commit:process.env.GITHUB_SHA||null,
  production_status:productionStatus,
  confirmation_status:confirmationStatus,
  checks,
  failures
};
await writeFile(path.join(root,'mobile-release-doctor.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exitCode=1;

