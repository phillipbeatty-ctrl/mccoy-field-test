# KNOCK DOOR GPS pilot

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

## Pilot and permission boundary

GPS UI remains enabled only on this project's Vercel previews and localhost.
Broader production-domain enablement is off. Server membership in
`private.field_gps_pilot` is also required and expires. An Admin with current
consent can START/PAUSE their own seven-day pilot. Existing enrollments and audits
are preserved; this follow-up does not enroll any user or relocate any customer pin.

The Edge endpoint derives actor identity with auth.getUser and applies the
existing organization gate. The service-role-only RPC rechecks active identity,
organization, pilot, current GPS consent and assignment rights. Admin may move
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
new endpoint/RPC. Reload the current preview to get KNOCK DOOR behavior. Ordinary
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

## Bounded release and source reconciliation

Keep the original applied `20260911222724_field_gps_placement_pilot.sql` unchanged.
Apply only the follow-up `20260911225650_knock_door_gps_placement.sql`, then deploy
`lead-gps-placement/index.ts` and `_shared/organization-paywall.ts` with JWT
verification. Never run a blanket database push. Verify exact deployed source,
RPC grants, retired action rejection and preservation of pilot/audit counts.

The legacy creation v6 source is frozen in
`supabase/releases/gps-placement/live-creation-v6.json`. Its known GitHub-only
organization wrapper is still reserved for the separate paywall release. This
change deploys no legacy creation, sale or broader paywall functions.
`verified-release.json` records the initial v1 release; the follow-up receipt
records the KNOCK DOOR backend separately.

## Acceptance before broader rollout

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
6. Pause the pilot and confirm ordinary address/sale actions still work.

Automated synthetic tests are not physical-doorway acceptance. Broader production
rollout and a newly bundled native Android release remain separate after acceptance.

## Eight-code review

- /PLAINLY: KNOCK DOOR is the GPS placement trigger.
- /ATTACK: Old placement actions and non-manual/completed visit receipts are rejected.
- /HOLES: Physical-device and actual-door accuracy still require the field pilot.
- /STEELMAN: Recording a knock gives placement a clear physical-action meaning.
- /SOWHAT: Address preparation and disposition entry cannot unexpectedly move a pin.
- /ODDS: Synthetic database and runtime tests establish code behavior, not GPS accuracy.
- /FAILHOW: A wrong typed address or poor GPS can still relocate the permitted group;
  original coordinates remain in the audit, and no false verification claim is made.
- /NEXT: Verify the revised preview at known doors before broader enablement.
