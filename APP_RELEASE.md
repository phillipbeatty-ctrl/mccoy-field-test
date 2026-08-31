# McCoy app release status

## Production web app

The production web build is available at:

- `https://www.mccoyplatform.com`
- `https://mccoy-field-test.vercel.app`

It is also configured as an installable Progressive Web App with a network-first service worker. Live Supabase lead, assignment, session, and sales traffic is never intentionally cached.

## Android internal beta — 1.0.0-beta.1

The repository now contains a reproducible Capacitor 8 Android build path with application ID:

```text
com.mccoyplatform.app
```

The CI workflow creates:

- An installable **debug APK** for controlled internal device testing.
- An **unsigned AAB** to verify that the Play release bundle compiles.
- A release-doctor report, APK package/SDK evidence, bundled-web metadata, and SHA-256 checksums.

The store build bundles McCoy's production web assets inside the native application. It does not use Capacitor `server.url` or `allowNavigation` to turn the public website into a remote production WebView.

The Android project is regenerated deterministically from the repository during CI, targets API 36, blocks cleartext network traffic, and declares camera plus foreground coarse/fine location permissions. No signing key is committed to the repository.

This internal beta is **not a public Play Store release**. The debug APK is suitable only for controlled testing. The unsigned AAB cannot be uploaded as McCoy's final Play release until a company-controlled Android upload key and Play Console application record exist.

## iOS continuation

The same source includes a reproducible Capacitor iOS project-generation script with:

- Bundle ID `com.mccoyplatform.app`
- Foreground-location purpose text
- Camera and selected-photo purpose text
- Safe-area handling
- The `mccoy://` application URL scheme

A distributable iPhone build still requires the McCoy **Apple Developer** team, App Store Connect application record, signing certificate, provisioning profile, and Xcode 26 or later. Those credentials and identifiers must remain outside the repository.

## Release order

1. Build and install `1.0.0-beta.1` on one controlled Android field device.
2. Run the real-device acceptance checklist for login, assigned leads, map interaction, GPS, active sessions, dispositions, provider handoff, restart persistence, and confirmation links.
3. Create the company-controlled Google Play Console application and Android upload key.
4. Produce and upload a signed AAB to Play internal testing.
5. Create the Apple Developer/App Store Connect application and generate a signed TestFlight build.
6. Complete privacy disclosures, store listings, screenshots, tester acceptance, and phased production release.
