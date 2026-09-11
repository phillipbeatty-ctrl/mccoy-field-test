# Manual address sales and paused nearest-lead automation

Automatic nearest-lead selection is paused by `app-field-features.js`.
The algorithms remain in source for a future reviewed release:

- `app-distance-to-lead.js`: nearest selection and linked automatic arrival/departure.
- `app-closest-lead-autofill-v2.js`: server nearest-lead lookup and address autofill.
- `app-lead-pool-independent-activity.js`: nearest visible map pin selection.
- `app-auto-door-arrival.js`: fallback GPS arrival and selection.

The switch defaults to false when configuration is missing. It does not stop GPS
collection, manual map selection, MOVE PIN, explicit arrivals/dispositions, or sale
distance auditing. The internal address-selection bridge starts empty and remains
hidden; Sales Hub has no lead dropdown or address suggestion list.

## Current behavior

Type a full service address in Sales Hub and press SALE. In Lead Pool, use
"Phone sale by address" and PROCESS SALE immediately; CENTER MAP is optional.
That existing phone flow retains its outside-system classification and Admin
approval requirement. Sales Hub uses the field-sale workflow.
No lead, permanent pin, GPS fix, geocode result, or active field session is required
to start the provider capture. Existing authentication, organization access,
provider completion and evidence requirements still apply.

Sales Hub has one Service address line inside Door Workflow. ADD ADDRESS saves
that same address as a pin, with no second form to fill out. Enter may also submit
ADD ADDRESS. Enter a full address as `Street, Unit, City, ST ZIP` (unit optional).
For example: `123 Main St, Apt 2, Portland, OR 97201`. Separate state/ZIP commas
and a trailing US country label are also accepted. Ambiguous address text gets an
inline format hint instead of a guessed city or nearby pin. This does not block
using the typed address for SALE.

SALE freezes the address before provider selection. Typed addresses do not inherit
an unrelated active door's lead, coordinates, or visit ID. Only an explicitly
selected matching door can be closed by that sale. Local matching uses the full
address, including locality/unit; stale map responses cannot replace newer input.
Refreshing the lead list preserves the address and database lead identity even
when numeric display IDs change. A delayed session restore cannot replace input
the user entered or cleared while it was loading.

ADD PIN / ADDRESS still opens the field-user form from Lead Pool or the maximized
map's action menu. The Sales Hub shortcut to that extra form is removed.
Both creation paths use the existing `lead-field-actions`
endpoint and still requires geocoding. PROCESS SALE FOR THIS ADDRESS can proceed
without creating a pin. Blank optional fields do not clear an existing matched
lead's contact information.
The editor now reads the app's actual lead state. After saving, it retries a stale
list once, clears display filters that hide the accessible lead, and selects and
centers its pin. A successful save followed by a refresh failure is reported as a
saved address, with the sale option retained. Choosing SALE restores a maximized
map so it cannot cover the provider chooser.

No Edge Function or database migration is changed in this release. Backend
permission and provider completion checks remain authoritative.

## Validation

Run `node --test manual-address-sales.test.mjs manual-address-refresh.test.mjs single-sales-hub-address.test.mjs`
for the pause, explicit selection,
address identity, unrelated-visit isolation, provider-intent snapshot, stale
geocode responses, geocode failure, role visibility and duplicate-contact checks.
The workflow also runs the existing sale completion, phone sale, map and access
regressions. These use controlled test inputs; they do not create production sales.
The full related suite passes 176 tests. The latest ten cover the one-line
interface, full-address parsing, unit preservation, shared creation, duplicate
clicks, late responses, inline errors and feedback retained through refresh/blur.
Review regressions also verify phone-sale classification through the provider
router and the loader's resolved-empty-array error path after a successful save.

Before accepting the mobile flow, verify on the preview with an active field
account: blank address stays blank as GPS changes; type an address absent from the
Lead Pool; confirm there is one input and no dropdown; press ADD ADDRESS and verify
its pin without retyping; open the provider flow and confirm the retained address;
add a legitimate
address from the maximized map; verify its pin and retry an existing address.
Finish a legitimate provider sale through the normal evidence/review process and
check the correct service address and unchanged unrelated physical visit.

## Re-enable later

Change `automaticNearestLead` only in a separate reviewed release. Prove manual
selection/typed-address priority, GPS accuracy and freshness, imported/low-precision
pin handling, concurrent pin changes, active-sale isolation, provider return,
and Android/iPhone/iPad behavior before enabling it. Re-test all four entry points
and bump the app-shell cache and asset versions together.

Known backend follow-up: creating the same new address concurrently uses separate
lookup/insert calls. A database uniqueness/transaction repair is needed to guarantee
deduplication across devices; sequential matching alone does not prove that case.
