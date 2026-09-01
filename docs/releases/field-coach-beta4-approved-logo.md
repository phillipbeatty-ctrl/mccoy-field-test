# Field Coach beta 4 approved-logo correction

## Purpose

Replace the beta 3 vector reconstruction as the active icon source with the exact newly approved uploaded artwork, while keeping McCoy Platform LLC as the legal company and `com.mccoyplatform.app` as the installed application identity.

## Immutable source evidence

- Approved JPEG: `assets/brand/approved-upload-original.jpg`
- Approved JPEG SHA-256: `227203e1c0ab14a1aa400e6f0d1411a6512222a685589df92dac3f3c1633cd90`
- Normalized PNG: `assets/brand/official-logo-source.png`
- Normalized PNG SHA-256: `ca00cdb16a50d463f9add9c15c4d193b038143f5e2b1cc4b86b9bc8cd4d787f5`
- Dimensions: 1024 x 1024
- Decoded pixels: identical

The historical embedded image from merge commit `7d93fa2fb628a4d2c08cb6e2674334c23080e272` is accepted only as recovery transport when its embedded JPEG checksum equals the newly approved upload exactly.

## Release identity

- Product: Field Coach
- Legal operator: McCoy Platform LLC
- Package ID: `com.mccoyplatform.app`
- Version name: `1.0.0-beta.4`
- Android version code: `4`
- iOS internal build number: `4`
- Service-worker cache: `field-coach-app-shell-v5-20260901-beta4-approved-logo`

## Safety boundary

This correction changes static branding assets, release metadata, build tests, and the controlled Android beta artifact only. It does not change Supabase data, Auth users, organization access, leads, assignments, dispositions, sessions, sales, compensation, provider evidence, or Resend configuration.

## Acceptance gates

- [ ] Exact JPEG checksum passes.
- [ ] Exact PNG checksum passes.
- [ ] JPEG and PNG decoded pixels match.
- [ ] Generated browser and PWA icons pass visible-content checks.
- [ ] Generated Android launcher files pass visible-content checks.
- [ ] Compiled APK-extracted launcher files pass visible-content checks.
- [ ] APK reports Field Coach, package `com.mccoyplatform.app`, version `1.0.0-beta.4`, code 4, and target SDK 36.
- [ ] Web download archive contains the approved source and checksum.
- [ ] Vercel preview is ready before merge.
- [ ] Production promotion occurs only after all checks pass.
