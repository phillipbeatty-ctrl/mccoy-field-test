# GPS doorway placement pilot

This implements the owner's September 11 decisions: ADD ADDRESS places new leads
at the user's reported GPS doorway and moves the complete matching address group,
including its apartments, to that point. Poor accuracy is recorded and does not
block an explicit placement. A later saved physical Visit improves only its own
pin when the fresh reading has strictly better reported accuracy.

The GPS point is a user-reported door, not independent proof that the typed address
is there. There is no old-pin distance limit and no artificial GPS-to-itself check.
Every original coordinate is retained in a private audit. No leads, apartments,
customer records, sales, or assignments are merged or deleted.

## Pilot boundary

The frontend exposes this pilot only on the project's Vercel preview URLs (and
localhost for development). The production domain retains existing behavior.
The server also requires an enabled, unexpired account membership in
`private.field_gps_pilot`. The migration enrolls nobody. An active Admin with the
current location consent can use **START GPS PILOT** in the existing Sales Hub
address area to enroll their own account for seven days. **PAUSE GPS PILOT** stops
new placements immediately. The server rechecks the pilot on every write.

Other pilot accounts require deliberate operator enrollment; no browser-supplied
role, organization, or actor can authorize an operation. Existing movement scopes
apply: Admin within organization; Manager/Trainer on their assigned leads; Rep on
their own assigned leads. Tester can create a new lead but has no expanded right
to move existing leads. If any matching pin is unauthorized, the entire group
operation stops. No partial moves and no disclosure of another organization's leads.

The earlier nearest-lead automation stays paused. GPS is requested only for
ADD ADDRESS and an explicit physical Visit. Calls, texts, phone sales and automatic
outcomes never reposition a pin. GPS failure does not block disposition saving or
manual address sales. Precise GPS is never logged to the browser console or Edge logs.

## Address and concurrency rules

Matching includes street, city, state and five-digit ZIP. Case, punctuation,
common street suffixes/directions and parsed inline apartment notation are
normalized. Unit identifiers remain distinct. House-number fractions and ranges
are retained. This is deliberately not fuzzy address or proximity matching.

All matching rows are locked in a stable order. GPS requests for a building
serialize with an advisory transaction lock; concurrent retries reuse a request
UUID scoped to actor and organization. A reused UUID with a changed payload is
rejected. A pin edited after GPS capture causes the whole placement to stop;
the next press obtains a fresh reading. GPS must have an actual browser capture
timestamp no older than 30 seconds, with at most five seconds of clock skew.
Invalid coordinates or missing accuracy cannot be substituted with zero.

One exact unit match may be selected after placement. Multiple exact duplicates,
or a building with multiple units and no specified door, return no selected lead.
The user can choose from the existing stacked/spiral map pins. A specified new
unit gets its own row while the building's existing rows are co-located.

Existing customer information is never broadcast to a group. Use the selected-door
contact editor for existing records. New-lead contact fields are created in the
same transaction as the location, request record and audit.

Disposition saving remains its existing operation. Location refinement then runs
as a separate audited transaction tied to that actor's saved physical Visit and
its exact GPS fields. If refinement fails, the disposition remains saved and the
UI says the pin update was not confirmed. Coordinate and audit writes always
commit or roll back together. Equal or worse subsequent accuracy leaves the pin.

## Source reconciliation and bounded backend release

The inspected production `lead-field-actions` is version 6, bundle SHA-256
`46aea73ccac87076d996c4eb7c84509cfece09c1ce2ed663b9e24e8a5241f803`.
Its exact source and deployment metadata are saved in
`supabase/releases/gps-placement/live-creation-v6.json`. The only difference from
the existing GitHub entry is the pending organization-access import and serving
wrapper. The release test verifies this precise difference and stops on extra drift.
The pending wrapper remains in source for its separate paywall release.

This pilot does not redeploy the existing creation endpoint. GPS creation instead
uses the new `lead-gps-placement` endpoint, protected by the same organization gate
already used by deployed `lead-admin`, plus the transaction's role, assignment,
consent and pilot checks. Its source is the exact release candidate; there is no
live-only GPS implementation. Existing sale functions and the broad paywall rollout
are outside this release.

Release only `20260911215359_field_gps_placement_pilot.sql`, then deploy
`lead-gps-placement/index.ts` with `_shared/organization-paywall.ts` and JWT
verification enabled. Do not run a blanket database push. The migration adds four
private tables, address helpers, one index and one service-role-only RPC. Verify
the resulting source, ACLs, empty initial pilot membership and unauthorized HTTP
rejection before inviting a doorway pilot. No production lead is needed for checks.

## Acceptance before broader rollout

Use a field-confirmed doorway on iPad, iPhone and Android browser/PWA. Start the
pilot on the chosen Admin account, then:

1. Enter a new complete address and press ADD ADDRESS. Confirm its map point is
   the physical doorway and record the displayed GPS accuracy.
2. Repeat with a known duplicate/multifamily group. Confirm all existing units
   stack, each retains its identity and customer information, and spiral selection
   opens the intended unit. Test both typed and imported apartment formats.
3. Save a physical Visit on one unit with a better reading. Confirm only that unit
   improves. Repeat with equal/worse accuracy; confirm no movement. ADD ADDRESS
   itself must still relocate deliberately even with worse accuracy.
4. Test denied GPS, an expired fix, an unauthorized mixed-assignment group, an
   interrupted response/retry and a simultaneous MOVE PIN. Confirm honest status,
   retained address, no duplicate insertion and no partial group writes.
5. Keep an unfinished address edit focused, open the map, and wait at least 70
   seconds through background refresh. Confirm first-tap focus, stable dropdowns,
   retained selection and no automatic nearest-lead selection.
6. Pause the pilot and confirm normal manual address sales still work.

Record device/browser, lead IDs (in the private test record), reported accuracy,
physical doorway comparison, group count, before/after outcome and any error code.
Automated synthetic tests are not field-doorway acceptance. Broader enablement and
a newly bundled native Android release remain separate steps after acceptance.
