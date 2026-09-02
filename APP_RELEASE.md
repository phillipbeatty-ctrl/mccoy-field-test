# Field Coach app release status

Field Coach is the product name. McCoy Platform LLC remains the company and the existing technical bundle owner.

## Production web app

The production web build is available at:

- `https://www.mccoyplatform.com`
- `https://mccoy-field-test.vercel.app`

It is configured as an installable Progressive Web App with a network-first service worker. Live Supabase lead, assignment, session, and sales traffic is never intentionally cached.

The installation center is `https://mccoyplatform.com/download.html`. iPhone and iPad use Safari's Add to Home Screen flow. Android users may install the web app or download the controlled native beta APK.

## Approved brand source

The owner-approved uploaded artwork was a 1024 x 1024 JPEG with SHA-256 `227203e1c0ab14a1aa400e6f0d1411a6512222a685589df92dac3f3c1633cd90`.

Its direct, non-redesigned PNG conversion is committed at:

```text
assets/brand/official-logo-source.png
```

The PNG is the sole authoritative build-time source. It is locked by:

- file SHA-256 `ca00cdb16a50d463f9add9c15c4d193b038143f5e2b1cc4b86b9bc8cd4d787f5`
- decoded RGB pixel SHA-256 `a07761316ddcbf77af92a7d6abbb2393ab1cde6ef251d0d39731788535a0279e`
- format `PNG`
- mode `RGB`
- dimensions `1024 x 1024`

The original JPEG hash remains provenance evidence, but the JPEG is not a second mutable source and is not required at build time. CI verifies the exact PNG before generating browser, PWA, Apple touch, Android launcher, adaptive-icon, and splash derivatives.

The approved composition is never redrawn, recolored, vectorized, regenerated, retouched, or cropped. Platform derivatives may only resize the complete composition or add safe padding.

## Android internal beta — 1.0.0-beta.4

The repository contains a reproducible Capacitor 8 Android build path with application ID:

```text
com.mccoyplatform.app
```

The visible app name, launcher label, installer metadata, and download filenames are **Field Coach**. Version code 4 identifies beta 4 as newer than beta 3.

### Persistent internal signing

Beta 4 is built as a release APK and signed with a persistent McCoy Platform LLC internal-beta certificate. The encrypted PKCS12 signing material is held in Supabase Vault and can be retrieved only by the `service_role` through a restricted `SECURITY DEFINER` RPC inside the protected GitHub `production` environment.

The private key, store password, and key password are not committed to the repository, written to release artifacts, or exposed to application users. CI verifies the keystore checksum and certificate fingerprint before signing, then verifies the finished APK certificate again before publication.

Locked beta 4 signing-certificate SHA-256:

```text
a3e8ca1f490053c2b38f1fc85c629fbefce2e8782e0dd4b03f55eb942f6df935
```

### Beta 3 clean-install boundary

The beta 3 APK was signed by a one-time CI debug key whose private key was not preserved. Android therefore cannot verify beta 4 as an authorized in-place update to beta 3, even though the application ID is unchanged.

The controlled beta 4 acceptance device must use a **clean installation**:

1. Record the beta 3 App Info and current test state.
2. Uninstall beta 3 from the controlled device.
3. Install the persistently signed beta 4 internal APK.
4. Sign in again and verify organization access, role, assignments, launcher, splash, login branding, restart behavior, and update behavior.

Future internal betas signed with the locked beta 4 key can update beta 4 in place.

### Build outputs

The CI workflow creates and verifies:

- a persistently signed internal APK;
- a signed internal AAB for controlled release verification;
- package ID, version name, version code, application label, target SDK, signer fingerprint, launcher-pixel, source-integrity, bundled-web, and release-doctor evidence;
- SHA-256 checksums for every release artifact;
- a stable official-domain APK at `downloads/Field-Coach-Android-1.0.0-beta.4-internal.apk`;
- a byte-identical `...-debug.apk` compatibility alias for the previously announced beta 4 route.

Android release optimization can rewrite physical ZIP entry names while preserving logical resource identities. CI therefore resolves the compiled `ic_launcher`, `ic_launcher_foreground`, and `ic_launcher_round` resources through `aapt2 dump resources`, extracts the resolved PNG entries, and verifies their decoded content instead of assuming their original source filenames remain in the APK.

The build bundles Field Coach's production web assets inside the native application. It does not use Capacitor `server.url` or `allowNavigation` to turn the public website into a remote production WebView.

The Android project is regenerated deterministically during CI, targets API 36, blocks cleartext network traffic, and declares camera plus foreground coarse/fine location permissions.

This internal beta is **not a public Play Store release**. Install it only from the official McCoy Platform domain. Play Console enrollment, public listing, store policy work, and production-store rollout remain deferred until explicitly authorized.

## iPhone and iPad web app

The immediate iOS target is the installable Field Coach web app in Safari, not an App Store or TestFlight release. The web app uses an explicit 180-pixel Apple touch derivative of the approved source, standalone metadata, safe areas, touch targets, install guidance, and service-worker update behavior.

The source retains a reproducible Capacitor iOS project-generation path for later. A native distributable would require the McCoy Platform LLC **Apple Developer** team, signing credentials, provisioning, and Xcode; those tasks remain outside the current release scope.

## Current release order

1. Verify the immutable approved PNG and deterministic derivatives on PR #109.
2. Build and sign Field Coach `1.0.0-beta.4` with the persistent internal certificate.
3. Verify package identity, version, target SDK, signer, launcher resources, APK checksum, and Vercel preview.
4. Publish the signed APK and checksum to the correction branch.
5. Merge only after every required automated and preview gate passes.
6. Confirm the production installation center identifies beta 4 and the APK route returns HTTP 200.
7. Perform a clean beta 4 installation on one controlled Android device and verify launcher, splash, login, organization access, assigned leads, restart persistence, and future update readiness.
8. Add the production web app to one iPhone or iPad Home Screen and verify icon, standalone launch, login branding, and cache-update behavior.
9. Defer public App Store and Play Store distribution until explicitly authorized.
