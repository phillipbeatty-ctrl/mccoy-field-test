import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mccoyplatform.field.dev',
  appName: 'McCoy Field Dev',
  webDir: 'mobile/www',
  bundledWebRuntime: false,
  android: {
    useLegacyBridge: true
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'https'
  }
};

export default config;
