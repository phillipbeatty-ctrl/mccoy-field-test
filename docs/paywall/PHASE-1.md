# Field Coach organization paywall — Phase 1

## Commercial model

Field Coach is released as a free, login-only organization companion application. Organization purchasing and subscription administration happen outside the iOS, iPadOS, and Android apps. The mobile apps contain no pricing, purchase button, checkout link, or external-purchase call to action.

If Field Coach later sells digital access directly to individual consumers, native store billing must be implemented before that offer is exposed in a mobile app.

## Authoritative access decision

An account may use Field Coach only when all of the following are true:

1. The organization is active.
2. The organization is marked `internal_unlimited`, or its selected subscription is active and unexpired, or it is in a non-expired trial.
3. The organization has the `field_coach_access` entitlement enabled.
4. The individual user's manual access remains active.

The database calculates the organization state. Browser visibility is not the security boundary.

## Effective access compatibility

Existing application and Edge Function authorization already checks the `active` value in `app_user_access` and, in some database paths, `organization_memberships`.

Phase 1 separates:

- `manual_active` — the Admin's deliberate user-access decision;
- `active` — the effective result of manual access plus organization subscription/entitlement access.

When an organization becomes unavailable, effective access becomes false. When it becomes available again, only users whose manual access remains true are restored. An Admin-deactivated user is not reactivated by a billing recovery.

## Audit and observability

The database stores:

- the latest evaluated organization access state;
- the denial reason;
- evaluation and state-change timestamps;
- a history entry when the organization changes between allowed and denied.

The client receives only the authenticated user's own organization access state.

## Client behavior

The app intercepts the normal access-ready event before dependent feature listeners receive it. Business UI remains locked while the server decision is pending or unavailable.

Allowed accounts continue normally. Denied accounts receive a dedicated organization-access screen with:

- a plain-language denial reason;
- organization/plan/status information when available;
- `CHECK AGAIN`;
- `SIGN OUT`;
- direction to contact the organization administrator.

The screen intentionally contains no in-app purchase flow.

## Phase 1 acceptance

- The current McCoy Platform LLC `internal_unlimited` organization remains allowed.
- Existing active-user and active-membership counts are unchanged for every allowed organization.
- Inactive, suspended, cancelled, unpaid, expired, or missing subscriptions fail closed.
- Disabling `field_coach_access` disables effective access.
- Re-enabling access restores only manually active users.
- Anonymous callers cannot invoke the access-state RPC.
- Gate state and history are not readable by browser roles.
- No lead, sale, assignment, session, or compensation record is modified.

## Remaining implementation

Phase 1 makes the platform-wide `active` checks subscription-aware and provides `private.assert_user_organization_access(user_id, entitlement)` for feature-specific enforcement.

The next phase must add that helper to every service-role Edge Function with the entitlement appropriate to the feature. It must then run direct PostgREST, RPC, Edge Function, Realtime, Storage, old-token, cross-role, and cross-organization bypass tests against a suspended test organization.

Future commercial work also includes selecting an external billing provider, a signed provider webhook, Admin billing controls, seat-limit policy, invoice/customer portal operations outside the mobile app, and a deliberate past-due grace policy.
