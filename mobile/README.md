# Field Coach — McCoy native development build

This is a development-only Capacitor shell for the existing McCoy web application. It does not replace the Vercel production app.

## Branding

- App name: **Field Coach**
- Developer/legal author: **McCoy Platform LLC**
- Development bundle id: `com.mccoy.fieldcoach.dev`
- Apple target: universal **iPhone + iPad** application

## Native session behavior

1. User signs in normally against the existing Supabase project.
2. **START KNOCKING** creates the existing server-controlled field session.
3. The native bridge registers a random session-scoped location token and starts `@capgo/background-geolocation`.
4. Location fixes are POSTed from native code directly to the `native-location-ingest` Supabase Edge Function, so delivery does not depend on the WebView staying active.
5. **STOP SESSION**, manual auto-stop, or server session stop emits `mccoy-field-session-ended`, stops native location and revokes the session token.
6. Browser/Vercel users never enter this path because it is gated by `Capacitor.isNativePlatform()`.

## iPadOS interface behavior

- On a full-width or wide iPad window, Lead Pool Knock mode keeps the map and lead list/detail panel visible side-by-side.
- When Split View or Stage Manager narrows the Field Coach window below the tablet-wide breakpoint, the app falls back to the existing single-workspace phone layout rather than squeezing the map and lead controls together.
- The Field Session and Live Session Stats cards use the wider tablet area while preserving the same START/STOP session controls.
- iPad touch controls use a minimum 48 px target size and the map is invalidated after tablet/window-layout changes.

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

## Apple TestFlight physical acceptance gate

The same signed TestFlight build must pass on **both a physical iPhone and a physical iPad** before either Apple device class can be promoted toward production distribution.

Run the following on each device:

1. Install the same Field Coach TestFlight build and sign in.
2. Grant precise location and the background/Always location access required by the active-session flow.
3. Tap **START KNOCKING** and confirm native location records begin.
4. Walk at least 30–50 meters with Field Coach visible and confirm `native_background_location` records arrive.
5. Switch to Maps and at least one provider/other app for 10+ minutes while continuing to move.
6. Lock the screen for several minutes while moving, then unlock.
7. Return to Field Coach and confirm the field session remained open and native location history covers the background period without an unexplained session break.
8. On iPad, rotate portrait/landscape and test a narrowed Split View or Stage Manager window; confirm full-width Lead Pool shows map + lead detail side-by-side and narrow mode falls back cleanly.
9. Tap **STOP SESSION**.
10. Confirm native tracking terminates and no new `native_background_location` records arrive after the recorded stop time.

A pass requires both device classes to complete all applicable steps. A failure on either device keeps PR #47 and native production promotion blocked.

## Known development limits

- Android native POST delivery is best-effort and the plugin does not persist failed points to disk.
- iOS/iPadOS stops background location if the user force-quits the app; this is an OS restriction.
- Simulator builds verify target compatibility, launchability, and responsive code contracts; they do not validate real background GPS behavior.
- Physical testing must include poor connectivity, Low Power Mode/battery saver, screen lock, app switching, permission changes, and explicit force-stop/force-quit scenarios before native distribution replaces the web app.
- This development build intentionally does not request Android `ACCESS_BACKGROUND_LOCATION` because continuous tracking is performed with a location foreground service; requesting the more sensitive background/geofence permission is unnecessary for this phase.
