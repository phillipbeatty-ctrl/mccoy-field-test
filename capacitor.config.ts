import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mccoy.fieldcoach.dev',
  appName: 'Field Coach',
  webDir: 'mobile/www',
  bundledWebRuntime: false,
  android: { useLegacyBridge: true },
  server: { androidScheme: 'https', iosScheme: 'https' }
};

export default config;
