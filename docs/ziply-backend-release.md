# Ziply backend release and reviewed recovery

This is the backend prerequisite for UI PR #131. Production release is authorized.
Run [34611945575](https://github.com/phillipbeatty-ctrl/mccoy-field-test/actions/runs/34611945575)
applied the migration and deployed provider-sale-capture v14, then stopped at
source verification. The other functions remain v31/v18 and UI PR #131 stays
draft until the protected backend recovery finishes successfully.

## September 11 partial release and exact recovery

The stopped run used main `bf71f7c459c0a30eefa3b5a5cbd316ae3d2f82cd`.
Its CLI download returned an unbundled eszip representation whose handler hash
did not equal the original source hash. An independent Supabase source-file
read proved both deployed capture files match the reviewed candidate byte for
byte. Verification now requests the Management API function body with
`Accept: multipart/form-data`, the same original-source path used by the
[official Supabase MCP](https://github.com/supabase/mcp/blob/main/packages/mcp-server-supabase/src/platform/api-platform.ts).
It checks the exact file set and byte hashes, including whitespace and newlines;
it does not normalize code or weaken the expected hashes.

The explicit `release_profile=after-34611945575` accepts only this reviewed state:

| Component | Required live state | Recovery action |
|---|---|---|
| Database | Ziply constraint plus exact version, name and SQL for migration `20260911121718` | Verify and retain; no SQL writes |
| provider-sale-capture | v14, original ID, JWT on, import map off, ACTIVE; bundle `78fa1bb80b27b0220da27986c283d6ec684984d3baeec10b7dd91aeb210c081c`; exact candidate files | Verify and retain; no redeployment |
| sale-submit | Original frozen v31 metadata and source bytes | Deploy reviewed Ziply package as v32; verify original files |
| provider-reconcile | Original frozen v18 metadata and source bytes | Deploy reviewed Ziply package as v19; verify original files |

Migration source SHA-256:
`4cf583acdf9154a6a76309bf08bdeb5e60069c2213b905187ac96738917ab426`.
Stopped-run evidence artifact ID: `10268467824`, SHA-256:
`50febdf9a7120442593e3110e1c1be4fa461675d5de597a0c199aacfd8b7c008`.
The frozen baseline, migration and all candidate runtime source remain unchanged.

After merging the recovery repair, start a **new** manual run on its reviewed
main commit with `operation=deploy`, `release_profile=after-34611945575`,
`expected_sha=<full new main SHA>`, and `confirmation=DEPLOY_ZIPLY`.
The deploy operation performs all read-only metadata, database/history and
original-source checks before its first write. The same profile also supports
`operation=preflight` for inspection only. Do not rerun the stopped old run:
it still checks out the old verifier. The default `original` profile deliberately
rejects the partial state; neither profile accepts arbitrary current versions.

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
   only reads function metadata, original source files, and the provider
   constraint/migration history. Choose the reviewed recovery profile when
   recovering the specific partial release described above.
3. After production release approval, run the same reviewed main version with
   `operation=deploy`, the same exact SHA, and `confirmation=DEPLOY_ZIPLY`.
4. The script checks all three function IDs, versions, bundle hashes, ACTIVE
   status, JWT verification and import-map settings before any production write.
   It verifies every source file before any write and rechecks metadata around
   source reads. The original profile also requires the original database
   constraint and no existing migration; recovery requires the exact retained
   migration and capture version instead.
5. Apply only the pinned migration and its exact history entry in one transaction.
   Verify the new constraint and history before deploying any function.
6. Deploy only provider-sale-capture, sale-submit and provider-reconcile, in
   that order, from the reviewed frozen packages. Each has an isolated build
   directory so their differing helpers cannot overwrite one another.
7. Re-read metadata and fetch original multipart source files to verify checksums
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

- /PLAINLY: The first deploy stopped after the database and capture function; recovery finishes the two remaining functions before the Ziply UI.
- /ATTACK: Hash verification remains exact. A CLI representation mismatch must not become permission to accept changed code or incidental access/ranking changes.
- /HOLES: Real Ziply seller/report acceptance and broader source/live drift remain open.
- /STEELMAN: The original stop prevented an unverified release. A pinned recovery preserves that protection while retaining independently verified work.
- /SOWHAT: Ziply becomes acceptable across capture, save and reconciliation without selecting Other.
- /ODDS: Independent source reads confirm the current partial state. Local handler and recovery tests provide code evidence; CI exercises Node 22 and real PostgreSQL. Neither proves real seller acceptance.
- /FAILHOW: Replaying the old deployment, accepting changed versions, weakening source checks, or publishing the UI before recovery would leave the release incomplete.
- /NEXT: Merge the tested recovery repair, run the exact protected recovery profile on the new reviewed main SHA, verify all three functions and database history, then publish UI PR #131.

References: [Supabase function deployment](https://supabase.com/docs/guides/functions/deploy),
[function metadata](https://supabase.com/docs/reference/api/v1-get-a-function),
[original function body](https://supabase.com/docs/reference/api/v1-get-a-function-body),
[Management API SQL](https://supabase.com/docs/reference/api/v1-run-a-query).
