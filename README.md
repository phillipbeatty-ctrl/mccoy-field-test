# Archived orphaned JS files

Archived on 2026-09-14 during a codebase cleanup pass.

These files were found to have **zero references** anywhere in the source tree
(no `<script>` tag in any `.html` file, no dynamic `script.src =` injection from
any other `app-*.js` file, no import, no test file exercising them).

Initial static analysis flagged 17 files as orphaned. On closer inspection, 15 of those
were actually loaded via runtime script injection (e.g. `app-page-layout.js`'s
`loadSaleLifecycle()`, or `app-sale-order-photo-admin.js` loading siblings at runtime) —
those were left in place.

Only these two showed no reference anywhere in current source:

- `app-customer-list-return-review.js` — superseded, likely by logic now living in
  `app-admin-sale-review.js` / `app-customer-list-credit-ranking-refresh.js` (not confirmed;
  verify before permanent deletion).
- `app-sales-hub-production-layout.js` — likely superseded by
  `app-sales-hub-fieldcoach-workday-layout.js`, which IS actively loaded.

Both files still appear as text strings inside the older bundled `.apk` files under
`/downloads/` (Capacitor bundles the web build into the native app), confirming they
were live in a past release but have since been replaced.

**Recommendation:** if nothing breaks in staging/production for 2-4 weeks, delete this
archive folder outright. Until then, keep it as a safety net.
