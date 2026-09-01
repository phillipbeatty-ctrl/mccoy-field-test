# Field Coach logo usage

## Approved source

The authoritative repository source is:

`assets/brand/official-logo-source.png`

This PNG is a direct, non-redesigned conversion of the approved uploaded JPEG. No redrawing, recoloring, vectorization, generative reconstruction, or compositional change is permitted.

### Original approved upload

- Repository evidence: `assets/brand/approved-upload-original.jpg`
- Original workspace filename: `ee07b6dc-1f03-591d-b867-6a983df1050f.jpg`
- Format: JPEG
- Dimensions: 1024 x 1024
- SHA-256: `227203e1c0ab14a1aa400e6f0d1411a6512222a685589df92dac3f3c1633cd90`

### Normalized build source

- Repository source: `assets/brand/official-logo-source.png`
- Format: PNG
- Dimensions: 1024 x 1024
- SHA-256: `ca00cdb16a50d463f9add9c15c4d193b038143f5e2b1cc4b86b9bc8cd4d787f5`
- Decoded pixels: identical to the approved JPEG

The historical embedded JPEG recovered from merge commit `7d93fa2fb628a4d2c08cb6e2674334c23080e272` is transport and recovery evidence only. It may be used only when its bytes match the approved JPEG checksum exactly.

## Rules

1. Do not redraw, vectorize, recolor, regenerate, retouch, or restyle the approved artwork.
2. All browser, PWA, Android, iPhone, iPad, launcher, and splash assets must be deterministic scale-and-padding derivatives of `official-logo-source.png`.
3. Any change to the source PNG or original JPEG requires explicit owner approval and a deliberate checksum update.
4. CI must verify both source checksums and decoded-pixel equality before generating derivatives.
5. `assets/logo.svg` is a deprecated historical compatibility asset and is not an approved brand source.
6. Platform-safe padding is allowed; cropping away approved content is not.

## Derivative policy

- **Full-brand surfaces:** display the complete approved composition.
- **Square browser and PWA icons:** resize the complete composition without cropping.
- **Maskable icon:** center the complete composition inside the maskable safe area on the approved dark background.
- **Android foreground:** center the complete composition on a transparent canvas; the Android background remains the approved dark background.
- **Splash screen:** center the complete composition on the approved dark background.
- **Apple touch icon:** resize the complete composition without cropping.

## Verification surfaces

Before production promotion, verify:

- browser favicon
- login and account-access branding
- installation and download pages
- PWA manifest icons
- iPhone and iPad Home Screen icon
- Android generated launcher resources
- Android APK-extracted launcher resources
- Android splash screen

The build must fail closed if a checksum, dimension, pixel comparison, or visible-content check fails.
