# Live Feed COMPANY and TEAM comments preview

This branch is a preview-only vertical slice. **Do not merge it and do not deploy its migration to the production Supabase project.** The mandatory first database-backed gate is now **Local Supabase Docker validation**. A paid Supabase Preview Branch is not required.

## Product objective

Extend the existing verified-sale Live Feed with lightweight operational comments while preserving sale authority and adding two explicit server-enforced scopes:

- **COMPANY** — verified sale events plus approved company comments.
- **TEAM** — approved comments for one authorized team. Verified sales remain in COMPANY and are not copied into team-comment feeds.

Comments remain completely separate from `sales_feed`, `sales_records`, rankings, compensation, provider verification, Customer List, Sales Bank, and accounting authority.

## Authority matrix

| Role | COMPANY read | COMPANY post | TEAM read | TEAM post | Moderate |
|---|---:|---:|---:|---:|---:|
| Admin | All company events | Yes | Every team in the organization, including historical inactive-team comments | Any active team | Every company/team comment |
| Manager | Yes | No | Active primary team and active teams managed by that user | Same authorized teams | No |
| Trainer | Yes | No | Active primary team and active teams managed by that user | Same authorized teams | No |
| Rep / Tester | Yes | No | Active primary team only | Active primary team only | No |

Managers and Trainers do not receive moderation authority in this preview. That remains a separate product decision.

All authority is enforced by database functions and Row Level Security. The browser receives only the scopes the server says the signed-in user may read or post. The scope selector is disabled during posting or permission revalidation, so a pending post cannot clear or enter another scope's draft or feed.

## Server-derived identity and team authority

The server derives the Auth user UUID, current login email, organization ID, display name, role, `users.id`, primary `users.team_id`, and active teams managed through `teams.manager_user_id`.

The current `auth.users.email`, JWT email, active `organization_memberships`, `app_user_access`, and user-profile identity must all match. An email change invalidates a stale token immediately rather than waiting for token expiry.

For TEAM comments, `(scope_id, organization_id)` has a composite foreign key to `teams(id, organization_id)`. A team ID from another organization cannot be stored even if application code is bypassed.

## Comment lifecycle

1. An authorized user selects COMPANY or TEAM from the server-provided scope list.
2. The user submits up to 280 Unicode code points.
3. Obvious customer-information patterns are rejected immediately.
4. Every free-form comment is inserted as `pending`.
5. Pending text is visible only to its author and organization Admins.
6. An Admin may approve only after affirmatively certifying that no customer data is present.
7. Approved text is published to the exact COMPANY or TEAM scope and may generate an in-app notification.
8. A rejection remains visible only to the author and Admin as audit state.

The migration is independently fail-closed; moderation is not deferred to a second migration.

## Version-one decisions

| Question | Preview behavior |
|---|---|
| Scopes | Explicit COMPANY and TEAM |
| Company content | Verified sales plus approved COMPANY comments |
| Team content | Approved comments for one authorized team; no copied sale events |
| Default view | Admin defaults to COMPANY; Manager, Trainer, and Rep default to the first postable TEAM when available |
| Comment relationship | Standalone chronological comments; no sale threads |
| Posting | Admin: COMPANY/TEAM. Manager/Trainer/Rep: authorized TEAM only |
| Moderation | Admin only |
| Persistence | Comments remain in their feed; only the floating notification expires |
| Editing | Not supported |
| Author deletion | Allowed within five minutes |
| Admin deletion | Allowed at any time; another user's comment requires a reason |
| Images and files | Not supported |
| Customer information | Prohibited; every free-form comment remains quarantined until Admin approval |
| Feed window | Last 30 days, capped at 100 events per selected scope |
| Offline behavior | Draft and normalized idempotency request remain on device; retry is explicit |
| Mentions | No `@mention` behavior |
| Notifications | In-app only; no push notifications |
| Sale priority | Verified-sale celebration remains visually dominant and delays comment notifications |

## Realtime and account-switch boundaries

Realtime subscribes at the organization row boundary and relies on the same RLS policy used by direct reads. TEAM rows are delivered only to users with current server-side authority for that team.

The client subscribes and then re-queries, preventing a snapshot-to-Realtime gap. If an event arrives while a query is in progress, one additional refresh is queued.

The client listens directly to Supabase `onAuthStateChange`, so a different account or sign-out clears the former feed synchronously before asynchronous onboarding and organization routing finish. Account, organization, role, active-access, and foreground permission changes invalidate older asynchronous responses and the former Realtime channel. During permission revalidation, the client hides the prior feed and draft, disables the composer, restarts Realtime, and performs a new selected-scope snapshot after subscription. While the app remains continuously foregrounded, a two-minute server authorization timer repeats the same fail-closed check; it defers during an active post and retries after fifteen seconds.

## Private moderation evidence

Moderation reasons, moderator IDs, deletion reasons, and deleting-user IDs are stored only in private audit tables. They are not columns on the Realtime-readable comment row. A soft deletion replaces the public body with `Comment removed.` before setting `deleted_at`; the redacted tombstone remains scope-authorized long enough for Postgres Changes to tell already-open clients to remove the event, while feed snapshots continue excluding deleted rows.

## Free-first verification

Run the source contract first:

```bash
npm run test:live-feed:local:contract
```

Then run the complete local database-backed test:

```bash
npm run test:live-feed:local
```

The Docker harness:

- starts a reduced local Supabase stack with Postgres 17, Auth, API, and Realtime on a Docker network whose published ports are bound to `127.0.0.1`, then inspects every project container and fails if any published host IP differs;
- uses a pinned Supabase CLI version;
- copies only a synthetic McCoy schema contract, the preview migration, and the rollback canary into `.tmp/live-feed-local`;
- never links a hosted project or uses a hosted project reference;
- applies no production data;
- runs direct policy checks as the actual `authenticated` database role;
- confirms RLS, Realtime publication, v2-only RPCs, and complete rollback;
- removes the temporary stack and files after the run unless explicitly retained for debugging.

The same test runs once per pull-request update in `.github/workflows/live-feed-local-supabase.yml`, checking out the exact pull-request head so a clean GitHub runner independently repeats the Docker validation without duplicate push-triggered runs.

See `docs/live-feed-free-test-plan.md` for the full operator and promotion procedure.

## Optional free hosted staging

After local Docker validation passes, a separate free Supabase project may be used when a genuinely free project slot is available. This is optional and is not a paid Preview Branch.

A hosted staging project must contain synthetic identities and comments only. A dedicated Vercel preview may point to its staging URL and publishable key. No command in the local harness can create, link, reset, or deploy to a hosted project.

## Promotion gate

The required order is:

1. **Local Supabase Docker validation** passes on the exact commit.
2. **Optional free Supabase staging project** is either passed or deliberately skipped with the reason recorded.
3. A **Controlled one-team production feature flag** is implemented as a default-off, server-enforced kill switch before any production pilot.
4. **Physical mobile testing** passes on controlled Android and iPhone/iPad installed clients.
5. **Wider rollout only after isolation passes** for same-team, different-team, cross-organization, reassignment, account-switch, offline-retry, moderation, and deletion cases.

The production pilot must keep COMPANY comments off initially, enable exactly one active team, and leave every other team on the existing verified-sale-only feed. The controlled team ID must be enforced in the RPC/database authorization layer, not by browser filtering.

Do not promote until:

- local Docker canary and source checks pass;
- security and performance findings are resolved or explicitly accepted;
- the one-team feature flag defaults off and its kill switch is tested;
- two same-team users, one different-team user, one Admin, and one cross-organization user pass desktop and physical mobile tests;
- team reassignment removes future Realtime/read authority for the old team;
- account switching cannot expose the former user's feed or draft;
- offline retry remains idempotent;
- no comment changes a sale, ranking, compensation, provider, Customer List, Sales Bank, or accounting record.

No production merge, production migration, production Realtime publication change, production feature enablement, or production comment data is authorized by this document.
