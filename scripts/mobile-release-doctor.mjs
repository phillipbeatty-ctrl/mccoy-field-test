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
const mobileIndex=await read('mobile-web/index.html').catch(()=>null);
const mobileBridge=await read('mobile-web/mobile-native-bridge.js').catch(()=>null);
const mobileBranding=await read('mobile-web/app-branding.js').catch(()=>null);
const mobileMetadata=JSON.parse(await read('mobile-web/mobile-build.json').catch(()=>'{"missing":true}'));

check('package version',packageJson.version==='1.0.0-beta.2',`expected 1.0.0-beta.2, received ${packageJson.version}`);
check('package name',packageJson.name==='field-coach-app',`expected field-coach-app, received ${packageJson.name}`);
check('Capacitor 8 core',packageJson.dependencies?.['@capacitor/core']==='8.5.0','@capacitor/core must be pinned to 8.5.0');
check('Android platform',packageJson.dependencies?.['@capacitor/android']==='8.5.0','@capacitor/android must be pinned to 8.5.0');
check('iOS platform',packageJson.dependencies?.['@capacitor/ios']==='8.5.0','@capacitor/ios must be pinned to 8.5.0');
check('bundle identifier',capacitorConfig.appId==='com.mccoyplatform.app','Capacitor appId mismatch');
check('product display name',capacitorConfig.appName==='Field Coach',`Capacitor appName must be Field Coach, received ${capacitorConfig.appName}`);
check('bundled production assets',capacitorConfig.webDir==='mobile-web','Capacitor webDir must be mobile-web');
check('no remote production WebView',!capacitorConfig.server?.url,'server.url is not allowed for a production store build');
check('no production navigation allowlist',!capacitorConfig.server?.allowNavigation,'allowNavigation is not allowed for this production wrapper');
check('local mobile index',Boolean(mobileIndex),'mobile-web/index.html is missing');
check('native bridge bundled',Boolean(mobileBridge&&mobileIndex?.includes('mobile-native-bridge.js')),'native bridge was not injected into the bundled index');
check('Field Coach branding bundled',Boolean(mobileBranding&&mobileBranding.includes("PRODUCT_NAME='Field Coach'")),'Field Coach branding controller was not bundled');
check('build metadata app ID',mobileMetadata.app_id==='com.mccoyplatform.app','mobile build metadata app ID is missing or incorrect');
check('build metadata app name',mobileMetadata.app_name==='Field Coach','mobile build metadata app name is missing or incorrect');
check('build metadata version',mobileMetadata.version==='1.0.0-beta.2','mobile build metadata version is missing or incorrect');

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
  source_commit:process.env.GITHUB_SHA||null,
  production_status:productionStatus,
  confirmation_status:confirmationStatus,
  checks,
  failures
};
await writeFile(path.join(root,'mobile-release-doctor.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exitCode=1;
