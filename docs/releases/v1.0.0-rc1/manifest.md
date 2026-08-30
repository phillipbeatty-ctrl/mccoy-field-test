# McCoy Platform v1.0.0-rc1 Release Manifest

## Release status

- **Status:** Release candidate cut; acceptance testing not yet complete
- **Release branch:** `release/v1.0.0-rc1`
- **Source branch:** `main`
- **Source commit:** `0b2a3fbc7e6918462298ad1c353d0eedde1fd084`
- **Source change:** Extend outside-area session auto-stop grace to 30 minutes
- **Release policy:** Feature-frozen. Only P0/P1 release-blocking corrections may be committed to this branch.

## Vercel baseline

- **Project:** `mccoy-field-test`
- **Project ID:** `prj_7SIrS4gTJXnSnDXC3QxKa2LPWamM`
- **Team ID:** `team_ei1vtkydjFE5sQVzlAPtR5OV`
- **Production URL:** `https://mccoy-field-test.vercel.app`
- **Known-good production deployment:** `dpl_CDELfXqzHHCgJEv99Aij2DHxKUt4`
- **Deployment source commit:** `0b2a3fbc7e6918462298ad1c353d0eedde1fd084`
- **Deployment state at RC cut:** `READY`
- **Recorded rollback candidate:** `dpl_Fhmi7kbeYA5G1KccsyjNBEfhujTM`

The RC must be tested against one exact preview deployment generated from this release branch. The preview deployment ID and share URL must be recorded here after Vercel finishes building the branch.

## Supabase baseline

- **Project ID:** `athxxrfqxwlfnuvbqadp`
- **Latest recorded production migration:** `20260830021536_outside_area_autostop_30_minutes`
- **Database release policy:** Every RC database change must have a committed migration, a rollback or recovery plan, and a production verification query.

### Active Edge Function inventory at RC cut

| Function | Version | JWT required | Status |
|---|---:|:---:|---|
| `field-analytics` | 3 | Yes | ACTIVE |
| `session-control` | 4 | Yes | ACTIVE |
| `sale-submit` | 26 | Yes | ACTIVE |
| `accounting-sales` | 5 | Yes | ACTIVE |
| `compensation-settings` | 6 | Yes | ACTIVE |
| `pay-progress` | 5 | Yes | ACTIVE |
| `company-leaders` | 7 | Yes | ACTIVE |
| `rep-coach-summary` | 8 | Yes | ACTIVE |
| `metrics-visibility` | 3 | Yes | ACTIVE |
| `rep-onboarding` | 18 | Yes | ACTIVE |
| `spotio-admin` | 2 | Yes | ACTIVE |
| `spotio-import` | 11 | Yes | ACTIVE |
| `lead-admin` | 20 | Yes | ACTIVE |
| `lead-geocode` | 9 | Yes | ACTIVE |
| `provider-reconcile` | 13 | Yes | ACTIVE |
| `apple-notes-sync` | 4 | No | ACTIVE |
| `sale-approvals` | 3 | Yes | ACTIVE |
| `accounting-records` | 9 | Yes | ACTIVE |
| `provider-sale-capture` | 8 | Yes | ACTIVE |
| `address-validation-pilot` | 4 | Yes | ACTIVE |
| `address-validation-repair` | 2 | Yes | ACTIVE |
| `address-validation-admin-review` | 2 | Yes | ACTIVE |
| `native-location-ingest` | 2 | No | ACTIVE |
| `sale-order-photo` | 1 | Yes | ACTIVE |
| `sale-order-photo-pilot` | 1 | Yes | ACTIVE |
| `provider-sale-photo-stage` | 1 | Yes | ACTIVE |
| `admin-session-history` | 1 | Yes | ACTIVE |
| `lead-map-address-search` | 1 | Yes | ACTIVE |
| `lead-address-lookup` | 1 | Yes | ACTIVE |

Functions without platform JWT verification require separate custom-authentication review before general release.

## Release invariants

These rules may not change during RC testing without explicit release-owner approval:

1. A verified processed order is the sale event used for the rep's record and competition totals.
2. Provider order/account evidence must reconcile to the provider seller identity linked to the credited McCoy user before official verified competition credit.
3. A later install, payment, or cancellation is downstream accounting/status information and does not erase that a verified processed order occurred.
4. Admin-selected credited-user changes must update authoritative rankings.
5. Lead Pool remote dispositions and phone sales must not close an unrelated active physical-door activity.
6. Map pin disposition is distance-independent; physical map knocking retains the proximity rule.
7. Session termination reason must remain auditable as manual stop or a specific automatic-stop reason.
8. Organization isolation is mandatory for all customer, lead, session, sale, accounting, and provider data.

## Change-control freeze

Until RC1 exits testing:

- No new features.
- No layout redesigns unless they fix a release-blocking usability failure.
- No production database edits without a committed migration.
- No Edge Function deployment without matching repository source.
- No full-branch merges from old preview branches.
- Every release fix must identify the failed acceptance case, include a regression check, and update the release tracker.
- P2/P3 work is deferred until after `v1.0.0`.

## Exit criteria

RC1 can become `v1.0.0` only when:

- All P0 and P1 acceptance cases pass.
- PC Chrome, physical iPhone, and physical iPad critical flows pass against the same RC build.
- No authentication freeze, blank page, cross-organization disclosure, incorrect credited user, ranking mismatch, duplicate sale lifecycle state, or unexpected session termination remains.
- Provider seller-account verification is operating or unverified provider sales are excluded from official competition totals pending Admin reconciliation.
- The exact Vercel deployment and Supabase function/migration versions are recorded.
- A 72-hour controlled-user soak completes without a release blocker.
- Rollback instructions are verified.
- A `v1.0.0` tag and GitHub release are created from the accepted RC commit.
