# Production promotion boundary

The beta 4 approved-logo branch is not production merely because its source files are committed.

Promotion requires:

1. Exact approved-source verification.
2. Browser and PWA derivative verification.
3. Android generated-resource verification.
4. Compiled APK-extracted launcher verification.
5. All repository regression workflows green on the final branch head.
6. Vercel preview Ready on the same final head.
7. Merge with the expected final head SHA so a later unreviewed commit cannot slip into production.

No Supabase or Resend mutation is part of this release.
