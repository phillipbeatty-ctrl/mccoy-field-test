import {readFile,writeFile} from 'node:fs/promises';

async function patchAndroid(){
  const path='android/app/src/main/AndroidManifest.xml';
  try{
    let source=await readFile(path,'utf8');
    const permissions=[
      '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
      '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
      '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
      '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />',
      '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
    ];
    for(const permission of permissions){if(!source.includes(permission))source=source.replace('<application',`${permission}\n    <application`);}
    await writeFile(path,source);
  }catch(error){console.warn('Android project not present yet:',error.message);}
}

async function patchIos(){
  const plistPath='ios/App/App/Info.plist';
  const projectPath='ios/App/App.xcodeproj/project.pbxproj';
  try{
    let source=await readFile(plistPath,'utf8');
    const insert=`\n\t<key>NSLocationWhenInUseUsageDescription</key>\n\t<string>Field Coach uses your location during an active field session to measure routes, arrival distance, and field activity.</string>\n\t<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>\n\t<string>Field Coach uses background location only while a field session is active so work activity can continue when you use another app or lock the device.</string>\n\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>location</string>\n\t</array>\n\t<key>UISupportedInterfaceOrientations~ipad</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t\t<string>UIInterfaceOrientationPortraitUpsideDown</string>\n\t\t<string>UIInterfaceOrientationLandscapeLeft</string>\n\t\t<string>UIInterfaceOrientationLandscapeRight</string>\n\t</array>\n`;
    if(!source.includes('NSLocationAlwaysAndWhenInUseUsageDescription'))source=source.replace('</dict>',`${insert}</dict>`);
    else if(!source.includes('UISupportedInterfaceOrientations~ipad'))source=source.replace('</dict>',`\n\t<key>UISupportedInterfaceOrientations~ipad</key>\n\t<array>\n\t\t<string>UIInterfaceOrientationPortrait</string>\n\t\t<string>UIInterfaceOrientationPortraitUpsideDown</string>\n\t\t<string>UIInterfaceOrientationLandscapeLeft</string>\n\t\t<string>UIInterfaceOrientationLandscapeRight</string>\n\t</array>\n</dict>`);
    await writeFile(plistPath,source);

    let project=await readFile(projectPath,'utf8');
    project=project.replace(/TARGETED_DEVICE_FAMILY = [^;]+;/g,'TARGETED_DEVICE_FAMILY = "1,2";');
    await writeFile(projectPath,project);
  }catch(error){console.warn('iOS project not present yet:',error.message);}
}

await Promise.all([patchAndroid(),patchIos()]);
console.log('Field Coach native location permissions and universal iPhone+iPad support configured.');
