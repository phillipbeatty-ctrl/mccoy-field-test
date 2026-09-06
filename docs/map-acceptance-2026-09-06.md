# Map acceptance — September 6, 2026

User-reported device results from this PR's acceptance session:

| Check | Result | Evidence |
| --- | --- | --- |
| Colored-control meanings | Passed, reported by user | Testers identified the controls correctly before coaching. |
| iPhone portrait and landscape map controls | Passed, reported by user | User reported both orientations worked perfectly. Exact model/iOS version was not supplied. |
| MOVE PIN cancel | Passed, reported by user | Cancel worked. |
| MOVE PIN confirmation | Failed on previous preview; repaired here | User could not confirm; server audit contained repeated stale_lead rejections. Must retest on device. |
| iPad maximize | Failed on previous preview; repaired here | User screenshots showed the map still in its original column. Must retest on device. |
| Android portrait and landscape field acceptance | Pending | No passing physical-device results recorded in this session. |

## Causes and repairs

- At widths above 900px, the Lead Pool workspace applied a higher-specificity display:contents rule to the map panel. This prevented its fixed fullscreen box from existing. Before this repair, a 1363 × 936 browser viewport reported expanded=true but a 702 × 491 map at x=244, y=194. Standard workspace rules now exclude the expanded panel.
- Deployed lead-pin-snapshot v2 contained only 488 characters and ended at Deno, before the handler. Restored the complete 3369-character checked-in handler as v3 and verified an exact source match.
- Snapshot loading now finishes before dragging starts. A failed or cancelled load cannot start a move. Coordinates and the full PostgreSQL timestamp are frozen at the start; confirmation no longer refreshes that version and silently overwrites a concurrent change.
- Supabase HTTP errors put structured rejection codes in error.context. Only known public recovery codes select the stale/GPS/assignment UI path; raw backend detail remains Admin-only.
- The service_role lacked EXECUTE on private.mccoy_distance_meters. Migration 20260906115319 grants that one role the one helper. Anonymous and authenticated client roles remain denied. No MOVE PIN authorization, organization, GPS, or audit validation was relaxed.
- MOVE PIN now starts from the dedicated launcher and remains available when the map is expanded. Pending confirmations prevent duplicate submissions.

## Verification

- 72 focused diagnostic, snapshot, map-window, map-layout, and move-safety tests pass locally. The old map-window assertion failures were reconciled with current code and protected by executable snapshot/confirmation regressions.
- The deployed RPC was tested as service_role inside a transaction that deliberately aborts. It saved the requested position, inserted its audit, and rejected a stale second request. The PASS exception rolled back all test updates and audit rows; a follow-up read confirmed zero retained test audits.
- scripts/verify-move-pin-rollback.sql is intentionally a rollback-only verification script. A MOVE_PIN_ROLLBACK_PASS exception is its successful outcome.
- No physical iPad or iPhone retest is claimed by the coding agent. Do not merge until remaining device acceptance is complete.
