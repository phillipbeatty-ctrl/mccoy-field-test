# Field Coach app release status

Field Coach is the product name. McCoy Platform LLC remains the legal company name, and the stable application identifier remains `com.mccoyplatform.app` so existing installations can be upgraded rather than replaced.

## Production web app

The production web build is available at:

- `https://www.mccoyplatform.com`
- `https://mccoy-field-test.vercel.app`

It is configured as an installable Progressive Web App named **Field Coach** with a network-first service worker. Live Supabase lead, assignment, session, and sales traffic is never intentionally cached.

## Android internal beta — 1.0.0-beta.2

The repository contains a reproducible Capacitor 8 Android build path with application ID:

```text
com.mccoyplatform.app
```

The launcher label, app switcher label, install prompts, bundled web UI, and release artifacts use the product name **Field Coach**.

The CI workflow creates:

- An installable **debug APK** for controlled internal device testing.
- An **unsigned AAB** to verify that the Play release bundle compiles.
- A release-doctor report, APK package/name/SDK evidence, bundled-web metadata, and SHA-256 checksums.

The store build bundles Field Coach's production web assets inside the native application. It does not use Capacitor `server.url` or `allowNavigation` to turn the public website into a remote production WebView.

The Android project is regenerated deterministically from the repository during CI, targets API 36, blocks cleartext network traffic, and declares camera plus foreground coarse/fine location permissions. No signing key is committed to the repository.

This internal beta is **not a public Play Store release**. The debug APK is suitable only for controlled testing. The unsigned AAB cannot be uploaded as Field Coach's final Play release until a company-controlled Android upload key and Play Console application record exist.

## iPhone and iPad continuation

The same source includes a reproducible Capacitor iOS/iPadOS project-generation script with:

- Product display name **Field Coach**
- Bundle ID `com.mccoyplatform.app`
- Foreground-location purpose text
- Camera and selected-photo purpose text
- Safe-area handling
- The stable `mccoy://` application URL scheme

A distributable iPhone/iPad build still requires the McCoy Platform LLC **Apple Developer** team, App Store Connect application record, signing certificate, provisioning profile, and Xcode 26 or later. Those credentials and identifiers must remain outside the repository.

## Release order

1. Build and install Field Coach `1.0.0-beta.2` on one controlled Android field device.
2. Verify that the Android launcher, app switcher, login, confirmation, installer, and every in-app header show **Field Coach**.
3. Run the real-device acceptance checklist for login, assigned leads, map interaction, GPS, active sessions, dispositions, provider handoff, restart persistence, and confirmation links.
4. Complete the shared security and organization-entitlement release gate.
5. Create the company-controlled Google Play Console application and Android upload key.
6. Produce and upload a signed AAB to Play internal testing.
7. Create the Apple Developer/App Store Connect application under the name **Field Coach** and generate a signed TestFlight build.
8. Test the universal app on iPhone and iPad, then complete privacy disclosures, store listings, screenshots, tester acceptance, and phased production release.
