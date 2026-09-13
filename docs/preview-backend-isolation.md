# Isolated Preview prerequisite for PR #137

This change prepares environment separation for the screenshot-upload Sale choices release. It does **not** contain the recovery-reviewed screenshot patch (`2026091203`, app-shell v27). That ZIP must still be recovered and reconciled with this branch before the release candidate is complete.

## Behavior

- Vercel evaluates `vercel.mjs` and runs `npm run build:web`. Both use the same validated deployment environment.
- Production builds preserve the existing production runtime bytes and HTTP headers. Source files remain unchanged during a build, including source used by native Android packaging.
- Preview builds require a separate Supabase project URL and a publishable key. Missing configuration, the production project or public key, malformed URLs, secret keys, and an unknown deployment environment stop the build.
- The emitted main app, email-confirmation page, pending-access page, and import page use the selected backend. Signup, password-reset and UPDATE APP destinations stay on the commit-specific Preview hostname supplied by Vercel.
- CSP permits the selected project's HTTPS and WebSocket endpoints; no wildcard Supabase permission is added.
- The Preview service-worker cache includes a configuration fingerprint. A failed build removes any old output so it cannot reuse a previous production bundle.
- The live development-queue/SMS Vercel APIs refuse to create their privileged database client outside Production. This happens before network access even if production credentials are inherited.
- Production APKs and downloadable production ZIPs are excluded from Preview output. Native acceptance requires its own rebuilt binary.

## Configuration and acceptance

Use an approved isolated Supabase branch with schema, Edge Functions, access policies, storage and synthetic test accounts. A separate URL/key alone does not establish backend readiness. The connected account currently exposes only the production project and its default branch; a test branch has not been created.

Set these public values for the Preview environment in the existing Vercel project:

| Name | Value |
| --- | --- |
| `MCCOY_PREVIEW_SUPABASE_URL` | The isolated branch URL in the exact form `https://<20-character-ref>.supabase.co` |
| `MCCOY_PREVIEW_SUPABASE_PUBLISHABLE_KEY` | That branch's `sb_publishable_...` key |

Leave Vercel's `VERCEL_ENV` and `VERCEL_URL` system variables enabled and unmodified. The build uses `VERCEL_URL` for the immutable deployment's redirect destinations. Authorize those destinations in the isolated backend's Auth settings. Do not copy production customer data or email/SMS secrets. Validate the public URL/key against the actual test branch before acceptance; a key's format alone does not prove which project issued it.

After publication, require a matching READY Preview, inspect `deployment-environment.json`, and verify actual served CSP, scripts and network destinations. The public manifest contains no keys. The current source changes have only been exercised locally with synthetic configuration; no real backend request or provider order was used in these tests.

Vercel documents build-time programmatic configuration and the `config` export at https://vercel.com/docs/project-configuration/vercel-ts . The installed standalone `@vercel/config` 0.7.0 CLI only searched for `vercel.ts`/`router.config.ts`. Vercel's deployed CLI 59.11.7 did recognize and evaluate `vercel.mjs`; the first published prerequisite stopped at `preview_backend_url_required`, as expected without a test backend. The policy JSON is statically imported so it is included when Vercel bundles its temporary configuration module. A complete build with actual isolated-backend settings remains required.

## Local validation

- 457 recovered repository source/asset files matched their recorded Git blob hashes at `3d46b71f77b4a17926c5019a41bc11a1a627289b`.
- This is a verified source snapshot, not an authenticated full Git clone. Five published APK download files are absent; the connector returned empty content for the sampled large APK. No native compilation or APK acceptance is claimed.
- `npm ci --ignore-scripts --no-audit --no-fund` succeeded with the repository lockfile.
- 23 focused checks passed: 16 new isolation checks and seven existing photo/popup regressions.
- The actual Preview asset build emitted 123 files using synthetic nonproduction configuration. All four actual browser client constructors were intercepted and checked before any request.
- The broad local test run was **533 passed / 25 failed** before these edits and **549 passed / 25 failed** afterward, with the same failure names. No existing assertion was weakened to remove those failures. Several failures are source-contract expectations for older behavior, but their complete classification remains unresolved.
- GitHub CI, Vercel's deployed build, authenticated uploads, and physical iPhone/iPad/Android acceptance have not been performed for this prerequisite.

## All eight thinking codes

| Code | Assessment and action |
| --- | --- |
| `/ATTACK` | A Preview URL can still write live sales. Configuration must cover every client entry, CSP, redirect destination and privileged API. |
| `/HOLES` | The latest recovery ZIP, a provisioned test backend, permitted complete-candidate publication, clean applicable CI and physical-device results remain missing. |
| `/STEELMAN` | A separate Supabase branch supports realistic authenticated uploads and failure recovery while preserving production data. |
| `/SOWHAT` | Test outcomes can be investigated without introducing invented sales, rankings or customer images into production. |
| `/ODDS` | Local deterministic cases pass. They provide no defensible probability of real-device or deployed-backend success. |
| `/PLAINLY` | This is the environment-isolation prerequisite. The screenshot feature is not ready for production. |
| `/NEXT` | Recover the reviewed ZIP, integrate its two patches, provision the approved isolated backend, configure Preview, publish the complete candidate, run applicable CI and record device acceptance. |
| `/FAILHOW` | Missing configuration, production refs/keys, credential inheritance, redirects leaving Preview, stale build reuse and cached backend changes are exercised. Real Safari photo-picker and backend recovery behavior still require acceptance. |

Keep PR #137 draft. Do not merge or promote a Preview configured with a test backend. A production release must build the approved revision with Production configuration after acceptance.
