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
  const path='ios/App/App/Info.plist';
  try{
    let source=await readFile(path,'utf8');
    const insert=`\n\t<key>NSLocationWhenInUseUsageDescription</key>\n\t<string>Field Coach uses your location during an active field session to measure routes, arrival distance, and field activity.</string>\n\t<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>\n\t<string>Field Coach uses background location only while a field session is active so work activity can continue when you use another app or lock the device.</string>\n\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>location</string>\n\t</array>\n`;
    if(!source.includes('NSLocationAlwaysAndWhenInUseUsageDescription'))source=source.replace('</dict>',`${insert}</dict>`);
    await writeFile(path,source);
  }catch(error){console.warn('iOS project not present yet:',error.message);}
}

await Promise.all([patchAndroid(),patchIos()]);
console.log('Field Coach native location permissions configured.');
