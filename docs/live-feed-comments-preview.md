# Live Feed comments preview

This branch is a preview-only vertical slice. It is not approved for production merge or production database deployment.

## Scope

The preview contains exactly three product pieces:

1. A separate, organization-scoped comment table with secure post/read/delete RPCs.
2. One chronological Live Feed that combines verified sale events with comments without mixing their storage or ranking semantics.
3. A subdued, nonblocking comment notification that drifts downward and expires automatically.

## Version-one decisions

| Question | Preview behavior |
|---|---|
| Comment relationship | Standalone chronological comments; no sale threads |
| Persistence | Comments remain in Live Feed; only the floating notification expires |
| Visibility | All active authorized members of the same organization |
| Posting | All active authorized organization members |
| Author notification | Immediate feed confirmation, no floating notification on the posting device |
| Editing | Not supported |
| Deletion | Author within five minutes; Admin anytime with a reason for another member's comment |
| Images and files | Not supported |
| Customer information | Explicitly prohibited; obvious contact, address, order, and account patterns are rejected server-side |
| Feed window | Last 30 days, capped at the most recent 100 combined events |
| Team scope | Not enabled; `scope` and `scope_id` reserve a future organization/team design |
| Offline behavior | Draft remains on the device; retry is always explicit and idempotent |
| Mentions | Not supported; `@` text has no mention behavior |
| Notifications | In-app only; no push notifications |

## Security boundary

Verified sales continue to use `public.sales_feed`. Comments use `public.live_feed_comments`. Comment operations never write to `sales_records`, `sales_feed`, rankings, compensation, provider reconciliation, Sales Bank, Customer List, or sale verification.

The server derives organization, Auth user ID, email, display name, and role from the signed-in identity. Authenticated clients receive organization-scoped SELECT access for Realtime, but no direct INSERT, UPDATE, or DELETE privileges. Writes use idempotent RPCs.

## Preview verification

Run:

```bash
node --check app-live-feed.js
node --check app-live-wins.js
node --check service-worker.js
node --test live-feed-comments-contract.test.mjs
```

After creating an isolated Supabase branch and applying the migration, run:

```text
supabase/tests/live-feed-comments-preview-canary.sql
```

The canary runs in one transaction and rolls back test organizations, identities, comments, and the synthetic sale event.

## Promotion gate

Do not promote until:

- an isolated Supabase preview branch passes the SQL canary;
- two preview users in the same organization can exchange comments in Realtime;
- a user in another preview organization cannot read or receive those comments;
- the author sees no floating notification for their own post;
- verified sale celebrations interrupt and outrank comment notifications;
- offline draft and explicit retry work on an installed iPhone/iPad web app and Android build;
- no comment changes a sale or ranking result.
