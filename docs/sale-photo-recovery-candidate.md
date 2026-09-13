# Screenshot upload and Sale choices candidate

Prepared September 13, 2026 from PR #137 at `5033438cc2b726b829043693bbf26639443eb0ec`. Keep the PR draft until the matching preview and physical acceptance are complete.

## Provenance and scope

The previously linked recovery-reviewed ZIP was unavailable. Earlier screenshot implementation source was recovered from the workspace, integrated with the published Preview-isolation prerequisite, and independently repaired and tested. This is a new candidate, not a checksum-verified reconstruction of that ZIP. Its asset revision is `2026091301` and its app-shell cache is `field-coach-app-shell-v28-20260913-photo-recovery`.

All 464 available baseline repository files match their Git blob hashes at `5033438`. Five historical downloadable APKs are absent locally. Publication builds on the existing remote tree and preserves those binaries. The local source snapshot is not an authenticated full Git clone.

## Resulting behavior

- The acknowledged upload of a selected screenshot opens Sale choices for the same signed-in account, provider and address. Merely taking a hardware screenshot, opening the picker or selecting a file does not record an outcome.
- Green submits the existing provider attempt once in the current interface. Red records abandonment without a sale or celebration. Both paths remain available without a photo.
- Pending attachments and cleanup have separate recovery records per account, capture and action. Completing another sale does not replace earlier recovery work.
- Failed cleanup remains explicitly pending and offers **RETRY PHOTOS**. Deletion is reported only after acknowledgement.
- Delayed responses can complete their own recovery record without clearing a newer attempt's state. Concurrent duplicate completion/retry events share the same in-flight attachment request within the page.
- Recovery checks the current session before sending attachment/cleanup requests. Known same-account legacy entries migrate; entries without account ownership or belonging to another login are retained without automatic submission.
- A storage-quota failure preserves an in-memory retry and tells the user to keep the page open. It cannot guarantee recovery after that page is closed, so no durable-save claim is shown.
- The native builder excludes generated `dist` output, preventing a previously built Preview from being copied into the native package.

The existing backend remains responsible for ownership, organization access, capture/sale matching and idempotent attachment. This change does not implement linked-provider-seller verification or change ranking/accounting eligibility. A screenshot is supporting evidence, not proof of a provider-account match.

## Validation

- 45 synthetic browser scenarios exercise the actual router, outcome screen, lifecycle and photo code. The new recovery scenarios were also run against the recovered earlier photo implementation to reproduce the failures before repair.
- Five release checks enforce matching HTML, lazy-loader, service-worker, unsigned and signed Android version assertions, and the PR regression workflow.
- 99 focused checks passed, including Preview isolation and the existing sale/runtime regressions.
- Broad root/shared tests: 583 passed and the same 25 baseline failures remained. No new failures. This is not a clean full-repository test result.
- A synthetic Preview build emitted 123 runtime files with matching photo-script bytes and a separately scoped cache. The native web bundle also passed, with generated Preview output absent. No local signed binary or physical-device result is claimed.
- Existing photo tests now supply the owned account and original picker tap required by the new behavior. Obsolete source expectations were updated for validated reload recovery and queued attachment/cleanup; upload, bucket and commit assertions remain.

GitHub CI and the configured Vercel deployment must be checked against the published candidate commit. Earlier green checks do not qualify this revision. The new `Screenshot upload Sale choices regression` workflow runs the 45 browser scenarios and five release checks using the committed lockfile.

## Isolated backend preparation

Read-only inspection on September 13 confirmed the existing `provider-sale-photo-stage` v6, `provider-sale-capture` v14 and `sale-submit` v32 endpoints. Both photo buckets are private, limited to 10 MiB, and permit JPEG, PNG and WebP. RLS is enabled on the capture, staged-photo, sale, sale-photo, access and storage-object tables. These observations are not a substitute for authenticated permission tests on the new branch.

The existing production project is `athxxrfqxwlfnuvbqadp`, owned by **McCoy Platform LLC** (`rsoxqqeuvbqspgofgqzx`). Only its default branch exists. Proposed development branch: **sale-choices-acceptance**, with no production data copied.

The account-specific quote is **$0.01344/hour** for the branch, approximately **$0.32/day** or **$9.68 per 30 continuous days** of base compute. Other usage can add charges; see [Supabase branch billing](https://supabase.com/docs/guides/platform/manage-your-usage/branching). The provisioning tool requires the user's explicit quoted-cost confirmation before creation. No cost confirmation or branch creation is claimed here.

After cost approval:

1. Create the development branch under the existing project, record its new project reference, and wait for healthy service/deployment status. Do not merge the Supabase branch or enable a production backend deployment.
2. Compare its deployed functions to the inspected live contracts. Check schema, access policies and both private buckets using `supabase/tests/preview-sale-photo-readiness.sql`. Verify Auth redirects and create only controlled synthetic test identities/data. Inspect any cloned hooks, secrets and scheduled jobs before test activity. The parent's sole active job is `close-stale-field-sessions`; the read-only inspection found no network call or production-project reference in that job.
3. Set only the two Preview values documented in [Preview isolation](preview-backend-isolation.md): `MCCOY_PREVIEW_SUPABASE_URL` and `MCCOY_PREVIEW_SUPABASE_PUBLISHABLE_KEY`. Verify the actual issued URL/key pair and exact Auth redirect hosts. Keep production email/SMS credentials out of the test environment.
4. Rebuild the exact candidate as a Vercel Preview. Check READY status, commit, `deployment-environment.json`, CSP, asset revisions and actual request hostname before uploads or test sales.
5. Run real-backend and physical-device acceptance below, record results, and repair any failures before considering production.

Resend connectivity was confirmed through the verified `auth.mccoyplatform.com` sending domain. No messages were sent and no Resend changes are required by this frontend candidate.

## All eight thinking codes

| Code | Finding and action |
| --- | --- |
| `/ATTACK` | An earlier test pass did not cover multiple unfinished photo actions. Recovery records must survive another sale, account change and reload. |
| `/HOLES` | The matching isolated backend, READY Preview, physical device evidence and 25 existing root-test failures remain unresolved. The original ZIP's exact bytes are unavailable. |
| `/STEELMAN` | A selected screenshot is useful supporting evidence, and a dedicated outcome screen can reduce forgotten choices while preserving the captured address. |
| `/SOWHAT` | A rep can finish the next sale without losing the previous photo retry. Failed cleanup no longer disappears with the prior attempt. |
| `/ODDS` | Passing synthetic checks establishes covered behavior only; no numerical production-success probability or device acceptance is inferred. |
| `/PLAINLY` | This candidate adds screenshot-upload-to-choices and photo recovery. It does not detect screenshots taken inside another application or verify the rep's provider account. |
| `/NEXT` | Publish this candidate, require its CI, obtain quoted-cost confirmation, provision/configure the isolated Preview, then record physical acceptance. |
| `/FAILHOW` | Regressions cover failed uploads/commit responses, failed attachment/cleanup, late responses, duplicate taps/events, expired sessions, account switches, reload and storage quota. Real network timeouts and Safari picker behavior remain acceptance gates. |

## Device acceptance record

Every row remains **NOT RUN**. Record the immutable Preview URL, exact commit, tester, date, OS/browser versions and actual observations. Test both portrait and landscape in the browser/PWA modes used by reps.

| Device | Upload and correct address | Green once and correct attachment | Red and cleanup retry | No photo and picker cancel | Network/timeout, login change and reload |
| --- | --- | --- | --- | --- | --- |
| iPhone | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| iPad | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Android | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

For each result, inspect the test backend capture, sale and photo records. Confirm that no upload alone creates a sale; repeated green taps create one sale; abandonment creates none; pending cleanup is truthful; late replies leave a new attempt unchanged; and each account recovers only its own work. Record failures and their repairs against the relevant commit.

Approval of a future tested revision is still required before merge/production. Keep the previous production deployment available for rollback. Native Android distribution needs a separately built and tested binary.
