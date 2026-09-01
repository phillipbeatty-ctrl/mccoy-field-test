#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const platform=String(process.argv[2]||'').toLowerCase();
const appDisplayName='Field Coach';
const versionName='1.0.0-beta.2';
const versionCode='2';

async function read(relativePath){return readFile(path.join(root,relativePath),'utf8');}
async function write(relativePath,content){await writeFile(path.join(root,relativePath),content);}

function insertBeforeOnce(source,needle,content,identity){
  if(source.includes(identity))return source;
  const index=source.indexOf(needle);
  if(index<0)throw new Error(`Native configuration failed: ${needle} was not found.`);
  return `${source.slice(0,index)}${content}${source.slice(index)}`;
}

async function configureAndroid(){
  const manifestPath='android/app/src/main/AndroidManifest.xml';
  let manifest=await read(manifestPath);
  const permissions=[
    'android.permission.CAMERA',
    'android.permission.ACCESS_COARSE_LOCATION',
    'android.permission.ACCESS_FINE_LOCATION'
  ];
  for(const permission of permissions){
    if(manifest.includes(`android:name="${permission}"`))continue;
    manifest=manifest.replace(/<application\b/,`    <uses-permission android:name="${permission}" />\n\n    <application`);
  }
  if(!manifest.includes('android:usesCleartextTraffic=')){
    manifest=manifest.replace(/<application\b/, '<application android:usesCleartextTraffic="false"');
  }
  const deepLink=`\n            <intent-filter>\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="mccoy" />\n            </intent-filter>\n`;
  if(!manifest.includes('android:scheme="mccoy"')){
    const activityClose=manifest.indexOf('</activity>');
    if(activityClose<0)throw new Error('Native configuration failed: MainActivity closing tag was not found.');
    manifest=`${manifest.slice(0,activityClose)}${deepLink}${manifest.slice(activityClose)}`;
  }
  await write(manifestPath,manifest);

  const stringsPath='android/app/src/main/res/values/strings.xml';
  let strings=await read(stringsPath);
  strings=strings
    .replace(/<string name="app_name">[^<]*<\/string>/,'<string name="app_name">Field Coach</string>')
    .replace(/<string name="title_activity_main">[^<]*<\/string>/,'<string name="title_activity_main">Field Coach</string>');
  if(!strings.includes('<string name="app_name">Field Coach</string>')){
    throw new Error('Native configuration failed: Android app_name was not set to Field Coach.');
  }
  await write(stringsPath,strings);

  const gradlePath='android/app/build.gradle';
  let gradle=await read(gradlePath);
  gradle=gradle.replace(/versionCode\s+\d+/,`versionCode ${versionCode}`);
  gradle=gradle.replace(/versionName\s+["'][^"']+["']/,`versionName "${versionName}"`);
  await write(gradlePath,gradle);

  const variables=await read('android/variables.gradle');
  if(!/targetSdkVersion\s*=\s*36\b/.test(variables)){
    throw new Error('Native configuration failed: Capacitor Android must target API 36.');
  }
  console.log(`Configured Android ${appDisplayName} ${versionName} (${versionCode}) with foreground location and camera permissions.`);
}

function plistEntry(key,value){return `\t<key>${key}</key>\n\t<string>${value}</string>\n`;}
function setPlistString(plist,key,value){
  const pattern=new RegExp(`(<key>${key}<\\/key>\\s*<string>)[^<]*(<\\/string>)`);
  if(pattern.test(plist))return plist.replace(pattern,`$1${value}$2`);
  return insertBeforeOnce(plist,'</dict>',plistEntry(key,value),`<key>${key}</key>`);
}

async function configureIos(){
  const plistPath='ios/App/App/Info.plist';
  let plist=await read(plistPath);
  plist=setPlistString(plist,'CFBundleDisplayName',appDisplayName);
  plist=setPlistString(plist,'CFBundleName',appDisplayName);
  const entries=[
    ['NSLocationWhenInUseUsageDescription','Field Coach uses your location during an active field session to show nearby assigned leads, record door distance, and support field-session safety.'],
    ['NSCameraUsageDescription','Field Coach uses the camera only when you choose to capture supporting order or field documentation.'],
    ['NSPhotoLibraryUsageDescription','Field Coach accesses selected photos only when you choose an existing image for supporting order or field documentation.'],
    ['NSPhotoLibraryAddUsageDescription','Field Coach can save a captured supporting image when you explicitly choose to keep it on this device.']
  ];
  for(const [key,value] of entries)plist=setPlistString(plist,key,value);
  if(!plist.includes('<string>mccoy</string>')){
    const urlTypes='\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>com.mccoyplatform.app</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>mccoy</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n';
    plist=insertBeforeOnce(plist,'</dict>',urlTypes,'<string>mccoy</string>');
  }
  if(!plist.includes('<string>Field Coach</string>')){
    throw new Error('Native configuration failed: iOS display name was not set to Field Coach.');
  }
  await write(plistPath,plist);

  const projectPath='ios/App/App.xcodeproj/project.pbxproj';
  let project=await read(projectPath);
  project=project.replace(/MARKETING_VERSION = [^;]+;/g,'MARKETING_VERSION = 1.0.0;');
  project=project.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g,'CURRENT_PROJECT_VERSION = 2;');
  await write(projectPath,project);
  console.log(`Configured iOS ${appDisplayName} ${versionName} with explicit foreground-location, camera, and photo usage descriptions.`);
}

if(platform==='android')await configureAndroid();
else if(platform==='ios')await configureIos();
else throw new Error('Usage: configure-native-project.mjs <android|ios>');
