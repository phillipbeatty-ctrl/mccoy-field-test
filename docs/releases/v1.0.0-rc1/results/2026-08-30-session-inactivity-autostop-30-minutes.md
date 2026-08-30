# Session inactivity auto-stop — 30 minutes

## Requested behavior

A field session may automatically stop for post-disposition inactivity only after 30 continuous minutes without a later door arrival or movement outside the configured stationary radius.

The same 30-minute inactivity limit applies after a sale and after every other disposition.

## Production change

Applied August 30, 2026 to Supabase project `athxxrfqxwlfnuvbqadp`.

Before the change, the active `default` session-control rule used:

- `post_disposition_idle_ms = 180000`
- `post_sale_idle_ms = 180000`

After the guarded migration:

- `post_disposition_idle_ms = 1800000`
- `post_sale_idle_ms = 1800000`
- Both database column defaults are `1800000`.

The `session-control` Edge Function was deployed as version 5 with JWT verification enabled. Its fallback behavior uses one `INACTIVITY_AUTO_STOP_MS = 30 * 60 * 1000` constant for both sale and non-sale inactivity.

## Unchanged behavior

- The browser continues checking the protected Edge Function every 15 seconds; it does not own the stop threshold.
- The outside-assigned-area grace period remains 30 minutes.
- The general stale-session closer remains 30 minutes.
- Manual Stop Session behavior is unchanged.
- A later door arrival prevents the post-disposition inactivity stop from firing for the prior door.

## Audit behavior

An inactivity auto-stop event now records the applied threshold as `inactivityAutoStopMs` in its protected event payload.

## Verification

GitHub Actions workflow `Session inactivity auto-stop 30 minutes`, run `33326621131`, passed:

- Session-control inactivity regression coverage
- Existing outside-area grace coverage
- Existing authoritative workday / Sales-per-Hour coverage
- Browser control JavaScript syntax validation

Production verification confirmed the active rule and both future database defaults are `1,800,000` milliseconds.
