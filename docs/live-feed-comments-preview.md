# COMPANY and TEAM Live Feed comments preview

This branch is a **preview-only vertical slice**. It is not approved for production merge or production database deployment.

## Scope

The preview contains three product pieces:

1. A separate, organization-bound comment table with explicit server-enforced `company` and `team` scopes.
2. A chronological Live Feed that combines verified sale events with comments for the selected authorized scope without mixing comment storage into sale or ranking authority.
3. A subdued, nonblocking comment notification that drifts downward and expires automatically.

## Authority matrix

| Role | COMPANY read | COMPANY post | TEAM read | TEAM post | Moderate |
|---|---:|---:|---:|---:|---:|
| Admin | All company events | Yes | Every active team | Yes | Every pending comment |
| Manager | Yes | No | Profile team and teams they manage | Yes | No in version one |
| Trainer | Yes | No | Profile team and teams they manage | Yes | No in version one |
| Rep / Tester | Yes | No | Current assigned profile team | Yes | No |

Every permission is derived from the signed-in Auth UUID, current JWT email, active organization membership, active app access, active user profile, role, and current team assignment. Browser-provided author, role, organization, and team identity are never authoritative.

## Feed behavior

- **COMPANY** contains organization-wide verified sale events and approved COMPANY comments.
- **TEAM** contains verified sale events for that team plus approved comments for that exact team.
- Admin defaults to COMPANY and can select any active team.
- Manager, Trainer, Rep, and Tester default to their first server-authorized team when available; COMPANY remains readable but read-only.
- A user reassigned away from a team loses new read, post, and Realtime access to that team.
- Managers and Trainers may moderate only after a separate product and authorization decision; version one remains Admin-only.

## Version-one decisions

| Question | Preview behavior |
|---|---|
| Comment relationship | Standalone chronological comments; no sale threads |
| Persistence | Comments remain in the selected Live Feed; only the floating notification expires |
| Posting | COMPANY is Admin-only; TEAM is restricted to server-authorized team membership/management |
| Author notification | Immediate pending feed confirmation; no floating notification on the posting device |
| Editing | Not supported |
| Deletion | Author within five minutes; Admin anytime with a reason for another member's comment |
| Images and files | Not supported |
| Customer information | Explicitly prohibited; obvious patterns are rejected and every free-form submission stays quarantined until Admin approval |
| Feed window | Last 30 days, capped at the most recent 100 events in the selected scope |
| Offline behavior | Draft and idempotency key are preserved per user and per scope; retry is explicit |
| Mentions | Not supported; `@` text has no mention behavior |
| Notifications | In-app only; no push notifications |

## Security boundary

Verified sales continue to use `public.sales_feed`. Comments use `public.live_feed_comments`. Comment operations never write to `sales_records`, `sales_feed`, rankings, compensation, provider reconciliation, Sales Bank, Customer List, or sale verification.

The initial migration is atomic and fail-closed. It creates moderation state, scope enforcement, Row Level Security, private audit records, RPCs, and Realtime publication in one transaction. There is no intermediate migration that can broadcast unreviewed text.

Authenticated clients receive RLS-scoped `SELECT` access for Realtime but no direct `INSERT`, `UPDATE`, or `DELETE` privilege. The RLS policy verifies the current JWT email against the active membership, access record, and user profile before applying COMPANY or TEAM visibility.

The public comment row does not expose moderation reasons, deletion reasons, moderator IDs, or deleting-user IDs. Those values remain only in immutable private audit tables.

## Moderation quarantine

Every free-form comment is inserted as `pending`.

- The author sees immediate pending confirmation.
- Organization Admins can review pending comments across COMPANY and all TEAM scopes.
- Ordinary users do not receive pending text through reads or Realtime.
- Approval publishes the comment only to its original scope.
- Rejection preserves private immutable evidence and never broadcasts the text.
- A pending comment older than 30 days cannot be approved.

## Client integrity

The preview also addresses the review findings discovered during the original vertical slice:

- normalized drafts retain one idempotency key after ambiguous network failures;
- Unicode code-point counting matches the 280-character server limit;
- author deletion controls expire after five minutes;
- initial snapshot and Realtime events are merged without a synchronization gap;
- the feed resets and unsubscribes when the authenticated account changes;
- the composer stays disabled until organization and scope are resolved, preventing typed input from being overwritten;
- drafts are stored separately for COMPANY and each TEAM feed.

## Preview verification

Run:

```bash
node --check app-live-feed.js
node --check app-live-wins.js
node --check service-worker.js
node --test live-feed-comments-contract.test.mjs
```

After explicit approval and creation of an isolated Supabase branch, apply only:

```text
supabase/migrations/20260903062000_live_feed_comments_vertical_slice.sql
```

Then run:

```text
supabase/tests/live-feed-comments-preview-canary.sql
```

The canary runs in one transaction and rolls back test organizations, teams, identities, comments, moderation events, and synthetic sale events.

## Promotion gate

Do not promote until all of the following pass on an isolated Supabase branch:

- Admin can read and post COMPANY and every TEAM scope.
- Manager and Trainer can post only to assigned/managed teams and cannot moderate.
- Rep can post only to the current assigned team.
- Every active authorized member can read COMPANY.
- A user in Team A cannot read or receive Team B comments.
- A user in another organization cannot read or receive either scope.
- Pending text remains visible only to its author and Admin until approval.
- A newly approved comment is delivered only to the authorized scope.
- Reassignment removes old-team access and changes available scopes after refresh/reconnect.
- Account switching clears the former user's feed, draft, role, team scope, and Realtime channel.
- Verified sale celebrations retain priority over comment notifications.
- Offline draft and explicit retry work on installed iPhone/iPad and Android builds.
- No comment changes any sale or ranking result.

No production migration, production Realtime publication change, or production comment data is authorized by this preview PR.
