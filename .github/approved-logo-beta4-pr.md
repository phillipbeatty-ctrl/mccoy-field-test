## Summary

Replace the beta 3 vector reconstruction with the exact newly approved uploaded artwork and make that artwork the immutable source for every Field Coach browser, PWA, Android, and future iOS derivative.

- preserve the exact approved JPEG with SHA-256 `227203e1c0ab14a1aa400e6f0d1411a6512222a685589df92dac3f3c1633cd90`
- lock the reviewed PNG conversion with SHA-256 `ca00cdb16a50d463f9add9c15c4d193b038143f5e2b1cc4b86b9bc8cd4d787f5`
- require checksum, dimension, and decoded-pixel equality before generation
- generate only scale-and-padding derivatives; no crop, redraw, recolor, vectorization, or generative reconstruction
- point dynamic and static brand surfaces at the approved source
- bump Field Coach to `1.0.0-beta.4`, Android code 4, iOS build 4, and a new app-shell cache identity
- verify generated icons and launcher resources extracted from the compiled APK
- publish a stable beta 4 APK only from the isolated correction branch

## Safety

No Supabase database data, Auth state, users, organization access, leads, assignments, dispositions, sessions, sales, compensation, provider evidence, Resend settings, or production secrets are modified.

## Acceptance

- exact approved-source checks pass
- browser/PWA icon visibility checks pass
- generated Android launcher checks pass
- APK-extracted launcher checks pass
- APK metadata reports Field Coach, `com.mccoyplatform.app`, beta 4/code 4, and target SDK 36
- web release package includes the approved source and checksum
- Vercel preview reaches Ready before production promotion
