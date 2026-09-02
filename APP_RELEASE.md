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

## Sale-completion runtime repair

Field Coach beta 5 contains the repaired provider-sale runtime:

- one browser-wide resolver locates the existing global lexical Supabase client without assuming `window.sb` exists;
- `COMPLETE SALE` submits once through `sale-submit` rather than using an asynchronous browser preflight and synthetic second click;
- `sale-submit` remains the atomic authority for authentication, organization, capture ownership, open status, duplicate prevention, canonical sale creation, and capture recording;
- private provider screenshot staging uses the same client resolver;
- failed completions remain visible in the Provider Outcome panel;
- executable browser tests cover sale creation, capture recording, private photo staging, Admin Sale Review visibility, ranking refresh, and stale/wrong-user blocking;
- the PWA shell is rotated to `field-coach-app-shell-v7-20260902-sale-completion-runtime`.

No migration or Edge Function deployment is required for this repair. The active server functions already contain the required ownership, state, and idempotency controls.

## Android internal beta — 1.0.0-beta.5

The repository contains a reproducible Capacitor 8 Android build path with application ID:

```text
com.mccoyplatform.app
```

The visible app name, launcher label, installer metadata, and download filenames are **Field Coach**. Version code 5 identifies beta 5 as newer than beta 4 and ensures existing beta 4 installations can receive the repaired embedded web runtime as an in-place update.

### Persistent internal signing

Beta 5 is built as a release APK and signed with the same persistent McCoy Platform LLC internal-beta certificate used by beta 4. The encrypted PKCS12 signing material is held in Supabase Vault and can be retrieved only by the `service_role` through a restricted `SECURITY DEFINER` RPC inside the protected GitHub `production` environment.

The private key, store password, and key password are not committed to the repository, written to release artifacts, or exposed to application users. CI verifies the keystore checksum and certificate fingerprint before signing, then verifies the finished APK certificate again before publication.

Locked internal signing-certificate SHA-256:

```text
a3e8ca1f490053c2b38f1fc85c629fbefce2e8782e0dd4b03f55eb942f6df935
```

### Update boundaries

The beta 3 APK was signed by a one-time CI debug key whose private key was not preserved. Android therefore cannot verify beta 4 or beta 5 as an authorized in-place update to beta 3, even though the application ID is unchanged.

- Beta 3 must be uninstalled before beta 5 is installed.
- Beta 4 can update to beta 5 in place because both use the same persistent internal signing certificate.
- Future internal betas must retain the same certificate and use a higher Android version code.

### Build outputs

The protected beta 5 workflow creates and verifies:

- a persistently signed internal APK;
- a signed internal AAB for controlled release verification;
- package ID, version name, version code, application label, target SDK, signer fingerprint, launcher-pixel, source-integrity, bundled-web, and release-doctor evidence;
- presence and content of the repaired Supabase resolver, sale lifecycle, and photo-staging scripts inside the compiled APK;
- SHA-256 checksums for every release artifact;
- a stable official-domain APK at `downloads/Field-Coach-Android-1.0.0-beta.5-internal.apk`;
- a byte-identical `...-debug.apk` compatibility alias for controlled testing.

Android release optimization can rewrite physical ZIP entry names while preserving logical resource identities. CI therefore resolves the compiled `ic_launcher`, `ic_launcher_foreground`, and `ic_launcher_round` resources through `aapt2 dump resources`, extracts the resolved PNG entries, and verifies their decoded content instead of assuming their original source filenames remain in the APK.

The build bundles Field Coach's production web assets inside the native application. It does not use Capacitor `server.url` or `allowNavigation` to turn the public website into a remote production WebView.

The Android project is regenerated deterministically during CI, targets API 36, blocks cleartext network traffic, and declares camera plus foreground coarse/fine location permissions.

This internal beta is **not a public Play Store release**. Install it only from the official McCoy Platform domain. Play Console enrollment, public listing, store policy work, and production-store rollout remain deferred until explicitly authorized.

## iPhone and iPad web app

The immediate iOS target is the installable Field Coach web app in Safari, not an App Store or TestFlight release. The web app uses an explicit 180-pixel Apple touch derivative of the approved source, standalone metadata, safe areas, touch targets, install guidance, and service-worker update behavior.

The source retains a reproducible Capacitor iOS project-generation path for later. A native distributable would require the McCoy Platform LLC **Apple Developer** team, signing credentials, provisioning, and Xcode; those tasks remain outside the current release scope.

## Current release order

1. Verify the repaired sale runtime and immutable approved PNG on PR #113.
2. Build and sign Field Coach `1.0.0-beta.5` with the persistent internal certificate.
3. Verify the package identity, version 5, target SDK, signer, launcher resources, embedded repaired scripts, APK checksum, and exact-head Vercel preview.
4. Publish the signed beta 5 APK and checksum to the PR branch.
5. Merge only after the generated release commit and every required automated and preview gate pass.
6. Confirm the production installation center identifies beta 5 and the APK route returns HTTP 200 with the published checksum.
7. Perform an in-place beta 4 to beta 5 update on one controlled Android device. Beta 3 devices must clean-install.
8. Refresh or reinstall the production web app on one iPhone or iPad and verify the v7 app shell, sale completion, private photo staging, Admin Sale Review visibility, and rankings.
9. Recover Dustin Gallagher's blocked order only after the original screenshot, provider order/account identifier, linked-seller identity, processed date, and duplicate checks pass.
10. Defer public App Store and Play Store distribution until explicitly authorized.
