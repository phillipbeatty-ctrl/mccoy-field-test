# Ziply backend release preparation

This is the backend prerequisite for UI PR #131. Preparation is authorized;
production deployment has not been run. This backend PR can merge independently
without exposing Ziply in the live user interface.

## Exact scope

- Add Ziply to the database ISP constraint and record migration
  `20260911121718_add_ziply_sale_provider` atomically.
- Add `Ziply` to the provider list and recognize `Ziply` / `Ziply Fiber` in each
  of three currently deployed function bundles.
- Preserve all three live entrypoints and every non-provider helper byte for
  byte. Do not change credentials, commissions, access rules, sale ownership,
  ranking policy, or existing provider behavior as part of this release.
- Keep the canonical organization/paywall guards and their existing tests.
  Do not deploy the wider paywall target list.

The frozen source is `supabase/releases/ziply-20260911/baseline.json`.
`scripts/ziply-release-package.mjs` checks its pinned SHA-256 and creates a
candidate and rollback source package for each function. Only two insertions
in each provider-core file are permitted. The resulting manifest shows all
baseline and candidate hashes; all nine non-provider files must match.

## Production source reconciliation

Inspection on September 11, 2026 used project `athxxrfqxwlfnuvbqadp` and compared
the live functions with repository main `4651f0b39e1b5655fd034e8cbdf9b8aa16cef99e`.

| Component | Inspected production | Repository difference | Ziply decision |
|---|---|---|---|
| provider-sale-capture | v13, JWT verification enabled | Adds the organization sales-tracking wrapper; formatting and comments also differ | Preserve v13 handler; add Ziply to its provider helper |
| sale-submit | v31, JWT verification enabled | Adds the organization sales-tracking wrapper; formatting and comments also differ | Preserve v31 handler; add Ziply to its provider helper |
| provider-reconcile | v18, JWT verification enabled | Adds the organization provider-integrations wrapper | Preserve v18 handler; add Ziply to its provider helper |
| sale-submit compensation helper | Small module containing pay-level helpers | Repository module also exports commission and bonus calculators | Preserve the deployed module and its existing exports |
| sale-submit location helper | Minified implementation | Formatting differs | Preserve the deployed file |
| provider-reconcile ranking helper | Requires completed outcome and complete metrics | Repository additionally recognizes capture-only completion and Admin-approved provider credit | Preserve the deployed ranking policy; review this existing divergence separately |
| Other reconciliation helpers | Deployed accounting, compensation and report modules | Files differ in trailing newline/formatting | Preserve exact deployed bytes |

This creates an explicit versioned production release profile. It does not claim
that the canonical paywall source and production are now identical. In
particular, the ranking divergence is a real existing behavior difference and
is not fixed by adding Ziply. Reconciliation authorization behavior also remains
as deployed; the scoped tests do not certify every multi-organization report
operation. These differences remain part of the wider source/live review.

## Protected release path

Workflow: `.github/workflows/ziply-backend-release.yml`.

The workflow uses the existing `production` environment and the same
`field-coach-paywall-phase2-production` concurrency group as the wider release.
It requires an owner-triggered manual run from main, the exact reviewed main
commit SHA, and successful package and disposable-PostgreSQL jobs. It also
reruns the canonical security-guard validation before accessing production.
There is no deployment on a PR or push event, and no production token in PR tests.

1. Review and merge the backend PR while UI PR #131 stays draft.
2. Run `Ziply backend package and protected release` on main with
   `operation=preflight` and `expected_sha=<full reviewed main SHA>`. Preflight
   only reads function metadata and the provider constraint/migration history.
3. After production release approval, run the same reviewed main version with
   `operation=deploy`, the same exact SHA, and `confirmation=DEPLOY_ZIPLY`.
4. The script checks all three function IDs, versions, bundle hashes, ACTIVE
   status, JWT verification and import-map settings before any production write.
   It also requires the original database constraint and no existing migration.
5. Apply only the pinned migration and its exact history entry in one transaction.
   Verify the new constraint and history before deploying any function.
6. Deploy only provider-sale-capture, sale-submit and provider-reconcile, in
   that order, from the reviewed frozen packages. Each has an isolated build
   directory so their differing helpers cannot overwrite one another.
7. Re-read metadata and download the deployed source to verify its checksums
   before continuing to the next function. Capture non-secret evidence on
   success or failure. No source downloaded during release is deployed.
8. Publish UI PR #131 only after the backend result is
   `backend_verified_ui_pending`. Verify seller account identity in SaraPlus
   and a legitimate completed Ziply order in capture, Customer List and reports.
   Real seller acceptance and Ziply report-format acceptance remain outstanding.

The Supabase CLI is pinned to 2.39.2, matching the existing release. Function
deployments retain JWT verification. The database change uses the documented
Management API SQL endpoint with the existing protected credential; the
repository migration version and SQL are stored in the same transaction.
This avoids applying unrelated pending migrations through a general db push.

## Failure and recovery

- Changed versions, source hashes, JWT settings or provider constraints stop
  before the first production write. Reinspect and review a new baseline;
  never force the old package over a changed function.
- The migration uses a 3-second lock timeout and 30-second statement timeout.
  A constraint or migration-history failure rolls the transaction back.
- A failed function deployment or checksum verification stops remaining
  deployments. Keep UI PR #131 unpublished and inspect `deployment.json`.
  A run is not automatically replayed after partial success: preflight rejects
  the now-changed function versions or recorded migration.
- The package artifact includes exact prior source under `rollback/` and the
  prior hashes. A recovery deployment needs review of the current versions and
  the same protected production controls. Never roll back over a newer release.
- Retain the additive Ziply constraint during a function recovery. Do not delete
  Ziply sales or narrow the constraint over existing records. If UI publication
  has occurred, pause new Ziply attempts before considering a backend rollback.
- The shared workflow lock coordinates these GitHub release paths. An external
  dashboard/API deployment can still race a deployment; coordinate a quiet
  release window and inspect the before/after evidence.

## Verification boundaries and thinking codes

- /PLAINLY: This prepares a backend-only release before the Ziply UI.
- /ATTACK: Handler and helper drift must not introduce incidental access or ranking changes.
- /HOLES: Real Ziply seller/report acceptance and broader source/live drift remain open.
- /STEELMAN: A temporary frozen production profile allows a small provider change with an auditable diff.
- /SOWHAT: Ziply becomes acceptable across capture, save and reconciliation without selecting Other.
- /ODDS: Local handler and release-control tests provide code evidence; CI exercises real PostgreSQL. Neither proves production acceptance.
- /FAILHOW: UI-first deployment, stale baselines, partial updates and bypassing protected release controls are the main failure paths.
- /NEXT: Review the backend PR, run protected read-only preflight after merge, approve and deploy this package, then publish UI PR #131.

References: [Supabase function deployment](https://supabase.com/docs/guides/functions/deploy),
[function metadata](https://supabase.com/docs/reference/api/v1-get-a-function),
[Management API SQL](https://supabase.com/docs/reference/api/v1-run-a-query).
