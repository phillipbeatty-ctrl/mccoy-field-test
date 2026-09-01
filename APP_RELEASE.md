# Field Coach app release status

Field Coach is the product name. McCoy Platform LLC remains the company and the existing technical bundle owner.

## Production web app

The production web build is available at:

- `https://www.mccoyplatform.com`
- `https://mccoy-field-test.vercel.app`

It is configured as an installable Progressive Web App with a network-first service worker. Live Supabase lead, assignment, session, and sales traffic is never intentionally cached.

## Android internal beta — 1.0.0-beta.2

The repository contains a reproducible Capacitor 8 Android build path with the existing application ID:

```text
com.mccoyplatform.app
```

The visible app name, launcher label, installer metadata, and download filenames are **Field Coach**. Keeping the existing application ID allows the new internal build to update the prior test installation instead of creating an unrelated second app.

The CI workflow creates:

- An installable **debug APK** for controlled internal device testing.
- An **unsigned AAB** only to verify that the Android release bundle still compiles.
- A release-doctor report, APK package/name/SDK evidence, bundled-web metadata, and SHA-256 checksums.

The build bundles Field Coach's production web assets inside the native application. It does not use Capacitor `server.url` or `allowNavigation` to turn the public website into a remote production WebView.

The Android project is regenerated deterministically during CI, targets API 36, blocks cleartext network traffic, and declares camera plus foreground coarse/fine location permissions. No signing key is committed to the repository.

This internal beta is **not a public Play Store release**. Store submission, signing-key creation, listing work, and Play Console work are intentionally deferred.

## iPhone and iPad web app

The immediate iOS target is the installable Field Coach web app in Safari, not an App Store or TestFlight release. Web-app work covers Apple touch icons, standalone metadata, safe areas, keyboard and viewport behavior, touch targets, install guidance, service-worker behavior, and iPhone/iPad acceptance.

The source still retains a reproducible Capacitor iOS project-generation path for later. A native distributable would eventually require the McCoy Platform LLC **Apple Developer** team, signing credentials, provisioning, and Xcode, but those tasks are outside the current release scope.

## Current release order

1. Build and install Field Coach `1.0.0-beta.2` on one controlled Android field device.
2. Complete server-side paywall and entitlement enforcement, including direct-bypass testing.
3. Complete and release the installable web app for Safari on iPhone and iPad.
4. Compare and select one of the three Field Coach interface directions.
5. Improve ergonomics and aesthetics around the selected direction.
6. Defer all public App Store and Play Store work until explicitly authorized.
