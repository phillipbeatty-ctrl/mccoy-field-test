# KNOCK DOOR GPS placement

The September 11 follow-up moves GPS placement from ADD ADDRESS and disposition
completion to **KNOCK DOOR** (formerly Start Address). All runtime label writers,
including authentication and address refreshes, use the same label.

## User flow

1. Type one service address. **ADD ADDRESS** resolves the complete matching group
   or creates the missing address/unit. It never asks for GPS or changes existing
   coordinates. A newly created address has no map coordinates until its knock.
   Duplicate rows are kept separate; ambiguity never picks the most recently active row.
2. At the physical door, tap **KNOCK DOOR**. The existing session/visit operation
   starts the visit, then one fresh GPS request places the matching address group.
   Every authorized duplicate and apartment moves to that point. Poor accuracy
   is applied and labeled; the point is the user's reported door, not independently
   verified proof of the address. No GPS-to-old-pin distance limit is added.
3. Record a disposition or sale. This does not acquire another placement fix or
   move the pin. A new visit's KNOCK DOOR can relocate the group again, including
   with worse reported accuracy. The earlier disposition refinement code is
   retained in the original migration/history, but its endpoint action is retired.

The visit and GPS transaction have separate outcomes. If GPS is unavailable or
rejected, the saved visit remains usable for disposition/sale. The status explains
what failed, and KNOCK DOOR retries GPS without creating another visit. A lost GPS
response reuses the exact request UUID/body until confirmed. A definite rejection
permits a fresh fix. Rapid repeated taps cannot start duplicate requests.

## Production and permission boundary

The user reported testing complete and authorized implementation on September 11.
The production follow-up enables the existing tested flow on McCoy's HTTPS web/PWA
domains. An operator-controlled `private.field_gps_rollout` setting enables only
the active `mccoy-platform-llc` organization. Current and future eligible users do
not need individual pilot enrollment. The production UI has no pilot toggle.
Existing preview pilot enrollments and audits are preserved.

The organization setting has no browser grants. The service role can read it but
cannot change it; production enablement requires an operator database operation.
Other organizations remain disabled unless separately enrolled for a pilot or
explicitly enabled. Existing account pilots still expire and work on previews.

The Edge endpoint derives actor identity with auth.getUser and applies the
existing organization gate. The service-role-only RPC rechecks active identity,
organization, rollout/pilot access, current GPS consent and assignment rights. Admin may move
pins in their organization; Manager/Trainer and Rep retain their assigned scope.
Tester has no expanded right to move existing rows. A mixed unauthorized group
rejects atomically without exposing other organizations or partially moving rows.

A GPS write additionally requires an owned, open field session and an active
manual/typed door visit. Completed visits, automatic-nearest visits, Lead Pool
activity receipts, other actors and expired/closed sessions cannot authorize it.
For a selected lead, the server derives the address and preserves that exact lead
identity. A typed address must match the saved visit; only an unambiguous exact
unit is linked back to the visit. Ambiguous buildings remain unselected for spiral
selection. A new exact lead is available immediately to the visit and sale context.

ADD ADDRESS and disposition GPS actions from older previews are rejected by the
new endpoint/RPC. Reload Field Coach to get KNOCK DOOR behavior. Ordinary
manual sales and the paused nearest-lead code remain available as before.

## Data integrity and responsiveness

Street, city, state and five-digit ZIP define a conservative address group. Units,
house fractions and number ranges remain distinct identities. No fuzzy proximity
match is introduced. All matching rows lock in stable order. Creation, group
coordinates, visit linkage, request receipt and per-lead original-coordinate
audits commit or roll back together inside the GPS operation. The already-saved
visit remains if this separate GPS operation rolls back.

Fresh fixes must have a real browser timestamp within 30 seconds (five seconds
future clock tolerance), valid coordinates and numeric accuracy. A later pin edit
or changed selected address rejects the group. Account, session, address revision
and active-visit guards prevent late browser responses from taking over a new
selection. Confirmed pin versions are compared at microsecond precision so a
late lead-list response cannot undo placement or a newer edit.

There is no new timer, GPS watcher, dropdown, address input or nearest selection.
Background updates retain active input elements, keyboard, cursor and edits.
The existing door status remains visible to every field role, with a polite live
region for GPS progress, success, low accuracy, failure and retry instructions.
Other coaching diagnostics retain their existing visibility rules.

## Bounded release and source reconciliation

Keep the already-applied `20260911222724_field_gps_placement_pilot.sql` and
`20260911231228_knock_door_gps_placement.sql` unchanged. Apply only
`20260911234631_field_gps_production_rollout.sql`, verify its recorded migration
version and RPC body, then run
`supabase/releases/gps-placement/enable-production.sql` for the approved McCoy
organization. The existing JWT-verified `lead-gps-placement` v2 bundle already
passes through the new status fields; no Edge function redeployment is required.
Never run a blanket database push. Verify exact deployed source, RPC/table grants,
retired action rejection and preservation of pilot/audit counts.

To pause new production placements, an operator sets the organization's rollout
row to `enabled=false`. Existing independent pilot enrollments must also be
disabled for a complete organization stop. Reload the app to refresh displayed
availability; server authorization is checked on every operation. Manual visits
and sales remain available, and previous pin coordinates remain in the audit.

The legacy creation v6 source is frozen in
`supabase/releases/gps-placement/live-creation-v6.json`. Its known GitHub-only
organization wrapper is still reserved for the separate paywall release. This
change deploys no legacy creation, sale or broader paywall functions.
`verified-release.json` records the initial v1 release; the follow-up receipt
records the KNOCK DOOR backend separately. `production-release.json` records the
production rollout and the user's acceptance without replacing historical receipts.

## Acceptance checklist

The user reports testing complete for the accepted PR #136 preview at commit
`2ff864a0e1f5e3e765a4ea9d55b6546ea8e2039d`. This is user-reported acceptance;
the release record does not claim separately observed device-by-device results.

Use field-confirmed doors on iPad, iPhone and Android browser/PWA:

1. ADD ADDRESS: existing coordinates stay unchanged; a new address is retained
   without a GPS prompt. SALE remains available.
2. KNOCK DOOR: the visit starts once and its complete permitted group moves.
   Confirm exact-unit identity, duplicate stacking and spiral selection.
3. Save disposition and sale: confirm neither repositions the group. Start a
   later visit and confirm KNOCK DOOR can place it again.
4. Deny GPS, interrupt a response, retry, and make a concurrent MOVE PIN. Confirm
   clear status, one visit, no duplicate audit and no partial group movement.
5. Change address/account while a request is pending. Confirm no stale selection
   takes over. Open the map and wait at least 70 seconds during unfinished input;
   require first-tap focus, stable keyboard/dropdowns and preserved edits.
6. Confirm ordinary address/sale actions still work when GPS is unavailable.

Automated synthetic tests are not physical-doorway acceptance. This release
publishes the production web/PWA. A newly bundled and signed native Android
release is separate; previously installed native bundles do not update with Vercel.

## Eight-code review

- /PLAINLY: KNOCK DOOR is the GPS placement trigger.
- /ATTACK: Old placement actions and non-manual/completed visit receipts are rejected.
- /HOLES: Acceptance is user-reported; native Android bundle publication is separate.
- /STEELMAN: Recording a knock gives placement a clear physical-action meaning.
- /SOWHAT: Address preparation and disposition entry cannot unexpectedly move a pin.
- /ODDS: Synthetic database and runtime tests establish code behavior, not GPS accuracy.
- /FAILHOW: A wrong typed address or poor GPS can still relocate the permitted group;
  original coordinates remain in the audit, and no false verification claim is made.
- /NEXT: Enable the approved organization, merge PR #136 and verify production assets.

Backend follow-up is verified: migration `20260911231228` is applied and
`lead-gps-placement` v2 is ACTIVE. Source bytes match review, browser RPC execution
is revoked, unauthenticated HTTP returns 401, and both retired actions reject.
The release preserved the existing one enrolled account and five audit rows.
See `supabase/releases/gps-placement/knock-door-release.json`. The four existing
private-table RLS-without-policy INFO notices are deliberate: no browser grants
are present. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Production backend verified: migration `20260911234631` is applied and the McCoy
organization setting is enabled. All 13 active linked field accounts tested
(Admin, Manager and Rep) return production-enabled status without a pilot toggle.
RPC and table grants match the intended boundary. Pilot enrollment and audit
counts remain one and five; release verification moved no customer pins. The new
private rollout table has the same deliberate RLS-without-policy INFO notice.
See `supabase/releases/gps-placement/production-release.json`.
