# Free-first Live Feed test and promotion plan

PR #118 no longer requires a paid Supabase Preview Branch as its first database test. The Company/Team design remains unchanged; only the validation and promotion route changes.

## Required order

1. **Local Supabase Docker validation**
2. **Optional free Supabase staging project**
3. **Controlled one-team production feature flag**
4. **Physical mobile testing**
5. **Wider rollout only after isolation passes**

Skipping forward is not permitted. A passing source build is not permission to merge, deploy the migration, or enable comments for the full organization.

## Stage 1 — Local Supabase Docker validation

This is the mandatory first database-backed test and has no Supabase branch charge.

### Prerequisites

- Docker Desktop or another Docker-compatible container runtime
- Bash 3.2 or later
- Node.js 22 or later
- enough local memory for the reduced Supabase stack

### Run

```bash
npm run test:live-feed:local:contract
npm run test:live-feed:local
```

The Docker command uses the pinned Supabase CLI version in `scripts/test-live-feed-local.sh`. It creates a temporary project under `.tmp/live-feed-local`, then copies only:

- the synthetic McCoy schema contract required by this feature;
- the preview-only Company/Team migration;
- the rollback canary.

It does **not** replay the repository's production migration history, link a hosted project, use the production project reference, run `db push`, or use real user/customer data.

The canary runs setup as the local database owner and switches direct policy assertions to the actual `authenticated` database role. It must prove:

- Admin, Manager, Trainer, Rep, and legacy Tester authority;
- Company and Team posting restrictions;
- pending-comment quarantine;
- same-team access and cross-team denial;
- cross-organization denial;
- current-email and stale-token denial;
- authenticated direct-write denial;
- redacted deletion delivery;
- verified-sale separation;
- complete rollback of synthetic records.

The script additionally verifies that RLS is enabled, `live_feed_comments` is in the local Realtime publication, legacy organization-wide v1 RPCs are absent, and no canary comment row survives.

The same command runs both the Company/Team feature contract and the free-test harness contract once per pull-request update in `.github/workflows/live-feed-local-supabase.yml`, checking out the exact pull-request head. The CI job is a second execution environment, not a replacement for running the command on a controlled developer machine.

### Local safety boundary

The script creates or verifies a Docker bridge whose published ports are bound to `127.0.0.1`, then passes that network to `supabase start --network-id` and inspects the resulting container port bindings before the canary runs. Do not replace it with a network that binds to `0.0.0.0`, and do not expose its Postgres, Auth, Realtime, or API ports to the public internet. Never import production data into the local harness.

## Stage 2 — Optional free Supabase staging project

This stage is optional. Use it only when a genuinely free project slot is available in an appropriate non-production Supabase organization.

A free staging project is a separate hosted project, not a paid Preview Branch and not the production project. It may pause after inactivity and is disposable.

Required safeguards:

- use a separate project reference and keys;
- never copy production Auth users or customer records;
- seed synthetic Admin, Manager, Trainer, Rep/Tester, second-team, and second-organization identities only;
- apply the preview migration only after confirming the target project reference twice;
- run the same rollback canary;
- point a dedicated Vercel preview only to the staging URL and publishable key;
- delete or pause the staging project when remote testing is complete.

No automation in PR #118 creates, links, resets, or deploys to a hosted Supabase project. That remains an explicit operator action so a local test command cannot reach production by mistake.

## Stage 3 — Controlled one-team production feature flag

A production pilot is allowed only after Stage 1 passes and either Stage 2 passes or Stage 2 is deliberately skipped with the reason recorded in the PR.

The production rollout guard must be implemented before the pilot migration is enabled. Its contract is:

```text
live_feed_comments_enabled = false              # default-off kill switch
live_feed_company_comments_enabled = false      # Company comments remain off for the first pilot
live_feed_controlled_team_id = null             # exactly one explicit team when enabled
live_feed_wider_rollout_enabled = false          # cannot be enabled during the pilot
```

The server, database policy, and RPC layer—not browser JavaScript—must enforce the controlled team ID. The flag must default off when the migration is first applied. Enabling the pilot requires one explicit active team ID and an Admin-authorized action with audit evidence.

During the one-team pilot:

- verified sales continue in Company exactly as before;
- Company comments remain disabled;
- only the controlled team receives a Team comment scope;
- every other team remains on the existing verified-sale-only feed;
- pending moderation, deletion, account-switch, and reassignment protections remain active;
- one kill-switch action must immediately stop new comment posting without changing sales or rankings.

PR #118 does not authorize applying the preview SQL to production yet. The default-off rollout guard and its tests must be part of the eventual production migration.

## Stage 4 — Physical mobile testing

After the controlled team is enabled, test with real installed clients and test-only comments that never use real customer data.

Minimum matrix:

| Device/account | Required result |
|---|---|
| Controlled-team Rep on Android | May read/post only the controlled Team feed |
| Second controlled-team user on iPhone/iPad Home Screen app | Receives approved Team comments through Realtime |
| Different-team user | Cannot see or select the controlled Team feed |
| Admin | Can review, approve, reject, and remove controlled-team comments |
| Same browser switching accounts | Former feed, draft, role, and Realtime channel disappear before the new account loads |
| Reassigned user | Loses future read/post/Realtime authority for the old team |
| Offline controlled-team user | Keeps one scoped draft and retries with the same request ID |

Also verify launcher, splash, login logo, update behavior, background/foreground permission refresh, deletion propagation, and verified-sale celebration priority.

## Stage 5 — Wider rollout only after isolation passes

Wider rollout remains blocked until all of these are evidenced:

- local Docker canary passes on the exact commit;
- any optional hosted staging test passes;
- controlled-team desktop and physical mobile tests pass;
- different-team and cross-organization access remain denied;
- account switching and team reassignment fail closed;
- no comment changes sales, rankings, compensation, provider verification, Customer List, Sales Bank, or accounting;
- security and performance findings are resolved or explicitly accepted;
- rollback and the production kill switch are tested.

Only then may a separate reviewed change set `live_feed_wider_rollout_enabled = true` or enable additional teams.

## Rollback order

1. Disable new comment posting with the server-enforced kill switch.
2. Stop the Realtime comment subscription in the client release.
3. Preserve private moderation/deletion audit evidence.
4. Leave verified sales and ranking behavior untouched.
5. Revert the comment migration only after confirming no required audit-retention obligation is violated.

## Decision record

The paid Preview Branch requirement has been removed. The mandatory first test is now local Supabase Docker. A free hosted staging project is optional, and production remains protected by a default-off, one-team, server-enforced rollout gate before physical mobile acceptance and any wider release.
