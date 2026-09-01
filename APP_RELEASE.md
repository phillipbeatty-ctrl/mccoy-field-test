# Field Coach app release status

Field Coach is the product name. McCoy Platform LLC remains the company and the existing technical bundle owner.

## Production web app

The production web build is available at:

- `https://www.mccoyplatform.com`
- `https://mccoy-field-test.vercel.app`

It is configured as an installable Progressive Web App with a network-first service worker. Live Supabase lead, assignment, session, and sales traffic is never intentionally cached.

The installation center is `https://mccoyplatform.com/download.html`. iPhone and iPad use Safari's Add to Home Screen flow. Android users may install the web app or download the controlled native beta APK.

## Approved brand source

The approved uploaded artwork is preserved byte-for-byte as `assets/brand/approved-upload-original.jpg`. Its direct PNG conversion is locked at `assets/brand/official-logo-source.png` and is the only permitted source for generated icons.

CI verifies:

- the original JPEG SHA-256
- the normalized PNG SHA-256
- 1024 x 1024 dimensions for both files
- decoded-pixel equality between the JPEG and PNG
- visible content in generated browser icons
- visible content in generated Android launcher resources
- visible content in launcher resources extracted from the compiled APK

The approved composition is never redrawn, recolored, vectorized, regenerated, or cropped. Platform derivatives may only resize the complete composition or add safe padding.

## Android internal beta — 1.0.0-beta.4

The repository contains a reproducible Capacitor 8 Android build path with the existing application ID:

```text
com.mccoyplatform.app
```

The visible app name, launcher label, installer metadata, and download filenames are **Field Coach**. Keeping the existing application ID allows beta 4 to update the prior test installation instead of creating an unrelated second app. Build code 4 forces Android to recognize this as a newer package than beta 3.

The CI workflow creates:

- An installable **debug APK** for controlled internal device testing.
- An **unsigned AAB** only to verify that the Android release bundle still compiles.
- A release-doctor report, source-integrity evidence, APK package/name/SDK evidence, bundled-web metadata, and SHA-256 checksums.
- A stable same-origin beta download at `downloads/Field-Coach-Android-1.0.0-beta.4-debug.apk`.

The build bundles Field Coach's production web assets inside the native application. It does not use Capacitor `server.url` or `allowNavigation` to turn the public website into a remote production WebView.

The Android project is regenerated deterministically during CI, targets API 36, blocks cleartext network traffic, and declares camera plus foreground coarse/fine location permissions. No signing key is committed to the repository.

This internal beta is **not a public Play Store release**. The debug APK is for controlled testing and must be downloaded only from the official McCoy Platform domain. Store submission, signing-key creation, listing work, and Play Console work remain deferred.

## iPhone and iPad web app

The immediate iOS target is the installable Field Coach web app in Safari, not an App Store or TestFlight release. The web app uses an explicit 180-pixel Apple touch derivative of the approved source, standalone metadata, safe areas, touch targets, install guidance, and service-worker update behavior.

The source still retains a reproducible Capacitor iOS project-generation path for later. A native distributable would eventually require the McCoy Platform LLC **Apple Developer** team, signing credentials, provisioning, and Xcode, but those tasks are outside the current release scope.

## Current release order

1. Build and inspect Field Coach `1.0.0-beta.4` on the isolated correction branch.
2. Verify the approved logo on the preview login, installation center, favicon, PWA manifest, and iPhone/iPad Home Screen assets.
3. Inspect generated and APK-extracted Android launcher evidence.
4. Install beta 4 on one controlled Android field device and verify launcher, splash, login, location, camera, assigned leads, map interaction, provider handoff, restart persistence, and update behavior.
5. Promote only after all automated checks and preview validation pass.
6. Complete remaining server-side paywall direct-bypass acceptance separately.
7. Defer all public App Store and Play Store work until explicitly authorized.
