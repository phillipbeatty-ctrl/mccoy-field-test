import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mccoy.fieldcoach',
  appName: 'Field Coach',
  webDir: 'mobile/www',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#f4f7fb',
    preferredContentMode: 'mobile',
  },
  android: {
    backgroundColor: '#f4f7fb',
  },
};

export default config;
