# Field Coach logo usage

## Authoritative source

The immutable repository source is:

`assets/brand/official-logo-source.png`

Locked properties:

- Format: PNG
- Color mode: RGB
- Dimensions: 1024 x 1024
- File SHA-256: `ca00cdb16a50d463f9add9c15c4d193b038143f5e2b1cc4b86b9bc8cd4d787f5`
- Decoded RGB pixel SHA-256: `a07761316ddcbf77af92a7d6abbb2393ab1cde6ef251d0d39731788535a0279e`

This PNG is a direct, non-redesigned conversion of the owner-approved uploaded JPEG. No redrawing, recoloring, vectorization, generative reconstruction, retouching, or compositional change is permitted.

## Original-upload provenance

The approved upload was a 1024 x 1024 JPEG with SHA-256:

`227203e1c0ab14a1aa400e6f0d1411a6512222a685589df92dac3f3c1633cd90`

That hash remains provenance evidence. The JPEG is not required at build time and is not retained as a second mutable brand source. The repository build fails closed on the exact PNG file hash, decoded-pixel hash, dimensions, format, and color mode.

The historical damaged transport recovered during beta 4 repair differed from the approved JPEG at exactly one audited byte: offset 82,130 changed from `0x28` to `0xA8`. After that correction, the JPEG matched the approved provenance hash and produced the locked PNG. All temporary recovery transports and workflows were removed after materialization.

## Rules

1. Do not redraw, vectorize, recolor, regenerate, retouch, crop, or restyle the approved artwork.
2. All browser, PWA, Android, iPhone, iPad, launcher, and splash assets must be deterministic scale-and-padding derivatives of `official-logo-source.png`.
3. Any change to the source PNG requires explicit owner approval and deliberate updates to both locked hashes.
4. CI must verify the source file hash, decoded-pixel hash, dimensions, format, and mode before generating derivatives.
5. `assets/logo.svg` is a deprecated historical compatibility asset and is not an approved brand source.
6. Platform-safe padding is allowed; removing approved content is not.

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
- Android APK signing-certificate fingerprint

The build must fail closed if a source hash, pixel hash, dimension, format, mode, signer, package identity, version, or visible-content check fails.
