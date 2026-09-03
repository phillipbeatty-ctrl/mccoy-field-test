# Live Feed COMPANY and TEAM comments preview

This branch is a preview-only vertical slice. **Do not merge it and do not deploy its migration to the production Supabase project.** A database-backed preview still requires explicit approval for an isolated Supabase branch.

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

The server derives the following from the authenticated Supabase identity and current McCoy organization:

- Auth user UUID
- current login email
- organization ID
- display name
- role
- `users.id`
- primary `users.team_id`
- active teams managed through `teams.manager_user_id`

The current `auth.users.email`, JWT email, active `organization_memberships`, `app_user_access`, and user-profile identity must all match. An email change invalidates a stale token immediately rather than waiting for token expiry.

For TEAM comments, `(scope_id, organization_id)` has a composite foreign key to `teams(id, organization_id)`. A team ID from another organization cannot be stored even if application code is bypassed.

## Comment lifecycle

1. An authorized user selects COMPANY or TEAM from the server-provided scope list.
2. The user submits up to 280 Unicode code points.
3. Obvious customer information patterns are rejected immediately.
4. Every free-form comment is inserted as `pending`.
5. Pending text is visible only to its author and organization Admins.
6. An Admin may approve only after affirmatively certifying that no customer data is present.
7. Approved text is published to the exact COMPANY or TEAM scope and may generate an in-app notification.
8. A rejection remains visible only to the author and Admin as audit state.

This initial migration is fail-closed by itself; moderation is not deferred to a second migration.

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

The client also listens directly to Supabase `onAuthStateChange`, so a different account or sign-out clears the former feed synchronously before asynchronous onboarding and organization routing finish. When the authenticated user, organization, role, or active-access signature changes without a page reload, the client increments an identity generation, removes the old channel, and clears the previous state before initializing again. Every asynchronous response and Realtime callback carries that generation and is discarded after a reset. Returning the app to the foreground also revalidates current team authority. The client synchronously hides the prior feed and draft and disables the composer before awaiting the permission snapshot. Applying the successful snapshot increments the client generation, discards every older in-flight feed/post/moderation response, restarts Realtime, changes the draft storage namespace before restoring any draft when the server organization changes, and then re-queries the selected COMPANY or TEAM feed after subscription so no event can fall between authorization and Realtime.

## Private moderation evidence

Moderation reasons, moderator IDs, deletion reasons, and deleting-user IDs are stored only in private audit tables. They are not columns on the Realtime-readable comment row. A soft deletion replaces the public body with `Comment removed.` before setting `deleted_at`; the redacted tombstone remains scope-authorized long enough for Postgres Changes to tell already-open clients to remove the event, while feed snapshots continue excluding deleted rows.

## Preview verification

Run:

```bash
node --check app-live-feed.js
node --check app-live-wins.js
node --check service-worker.js
node --test live-feed-comments-contract.test.mjs
```

After an isolated Supabase branch is explicitly approved and created, apply only `supabase/preview-migrations/20260903062000_live_feed_company_team_comments_preview.sql` and run:

```text
supabase/tests/live-feed-comments-preview-canary.sql
```

The canary must roll back all test data and prove:

- Admin can post COMPANY or any active organization TEAM.
- Manager and Trainer can post only their authorized TEAM scopes and cannot moderate.
- Rep can post only the assigned TEAM. A legacy `tester` access role is normalized to Rep authority while the profile remains `rep`.
- Every role can read COMPANY.
- Team A cannot read Team B comments.
- Organization A cannot read Organization B comments.
- Pending comments are author/Admin-only.
- Approved comments publish only to the selected scope.
- verified sales appear in COMPANY and never become team comments.
- current-login email mismatches fail closed.
- direct authenticated table writes remain denied.
- moderation metadata remains private.

## Branch implementation checkpoint

The preview source now uses one consolidated, independently fail-closed migration stored outside the production migration directory, plus scoped v2 RPCs. Source-level checks cover explicit COMPANY/TEAM authority, null COMPANY scope IDs, current `auth.users.email` validation, stale-async generation invalidation, foreground permission revalidation after team reassignment, account switching, scoped offline idempotency, moderation quarantine, Realtime recovery, and strict comment separation from sales authority.

The final one-time materialization and migration-boundary workflows remove their own scaffolding. A subsequent human-authored branch commit is required so the repository's ordinary pull-request workflows execute on the exact reviewable head rather than remaining in GitHub's `action_required` state for a bot-authored commit.

This checkpoint is intentionally a branch-only validation marker. It does not replace the isolated Supabase canary, cross-user Realtime testing, security/performance advisors, or physical mobile acceptance required below.

## Promotion gate

Do not promote until:

1. An isolated Supabase preview branch passes the SQL canary.
2. Security and performance advisors pass or every finding is explicitly resolved.
3. A Vercel preview points only to that isolated branch.
4. Two same-team users, one different-team user, one Admin, and one cross-organization user pass desktop and mobile tests.
5. Team reassignment removes future Realtime/read authority for the old team.
6. Account switching in one browser cannot expose the former user's feed or draft.
7. Offline retry remains idempotent.
8. No comment changes a sale, ranking, compensation, provider, Customer List, Sales Bank, or accounting record.

No production merge, production migration, production Realtime publication change, or production comment data is authorized by this document.
