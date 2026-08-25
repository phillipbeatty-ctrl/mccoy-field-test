# Field Coach — McCoy native development build

This is a development-only Capacitor shell for the existing McCoy web application. It does not replace the Vercel production app.

## Branding

- App name: **Field Coach**
- Developer/author: **McCoy**
- Development bundle id: `com.mccoy.fieldcoach.dev`

## Native session behavior

1. User signs in normally against the existing Supabase project.
2. **START KNOCKING** creates the existing server-controlled field session.
3. The native bridge registers a random session-scoped location token and starts `@capgo/background-geolocation`.
4. Location fixes are POSTed from native code directly to the `native-location-ingest` Supabase Edge Function, so Android delivery does not depend on the WebView staying active.
5. **STOP SESSION**, manual auto-stop, or server session stop emits `mccoy-field-session-ended`, stops native location and revokes the session token.
6. Browser/Vercel users never enter this path because it is gated by `Capacitor.isNativePlatform()`.

## Android device test

The GitHub Action `Field Coach Android Dev` builds a debug APK artifact named `field-coach-android-dev-apk`.

Test on a physical Android phone/tablet:

1. Install the debug APK.
2. Sign in to Field Coach.
3. Allow precise location and notifications when requested.
4. Tap **START KNOCKING** and confirm the persistent `Field Coach — session active` notification appears.
5. Walk at least 30–50 meters while Field Coach is visible and confirm native location events arrive.
6. Open another app for at least 10 minutes and continue walking.
7. Lock the screen for several minutes, then unlock.
8. Return to Field Coach and confirm the session remained open.
9. Tap **STOP SESSION** and confirm the persistent location notification disappears.
10. Verify no new `native_background_location` events arrive after the stop time.

## iOS device test

Run `npm run mobile:add:ios`, open the generated project with `npm run mobile:open:ios`, select the McCoy Apple development team in Xcode, and install on a physical iPhone/iPad. iOS background location requires the location background mode and the user-facing permission descriptions configured by `scripts/configure-native-location.mjs`.

## Known development limits

- Android native POST delivery is best-effort and the plugin does not persist failed points to disk.
- iOS stops background location if the user force-quits the app; this is an OS restriction.
- Device testing must include poor connectivity, battery saver, screen lock, app switching, permission changes, and explicit force-stop/force-quit scenarios before native distribution replaces the web app.
- This development build intentionally does not request Android `ACCESS_BACKGROUND_LOCATION` because continuous tracking is performed with a location foreground service; requesting the more sensitive background/geofence permission is unnecessary for this phase.
