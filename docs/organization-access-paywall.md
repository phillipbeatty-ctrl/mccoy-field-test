# Field Coach organization access paywall

Field Coach uses an organization-managed access model. The iOS, iPadOS, Android, and web clients do not sell access, show prices, or link to an external checkout. An organization obtains access outside the app, authorizes users, and the server decides whether each signed-in user may load business data.

## Authoritative decision order

1. Supabase Auth user is valid.
2. User has an active `organization_memberships` row.
3. User has an active `app_user_access` row for the same organization.
4. Organization is active.
5. Organization billing state and latest subscription state are compatible.
6. Trial, paid period, or past-due grace period has not expired.
7. Requested entitlement is enabled, except for `internal_unlimited` organizations.
8. Active seats do not exceed the subscription seat limit.

The central PostgreSQL decision is:

```sql
private.organization_access_state(organization_id, entitlement)
```

Authenticated clients use:

```sql
public.current_organization_access_state(entitlement)
```

Service-role Edge Functions use:

```sql
public.service_organization_access_state(auth_user_id, entitlement)
public.service_assert_organization_access(auth_user_id, entitlement)
```

## Billing states

| Organization billing state | Required subscription state | Time rule | Result |
|---|---|---|---|
| `internal_unlimited` | Operator-managed internal access | No expiration required | Allow |
| `trial_active` | `trialing` | `current_period_end` must be in the future | Allow until expiry |
| `paid_active` | `active` | External-provider subscriptions require a verified unexpired period; manual subscriptions may omit a period | Allow |
| `past_due_grace` | `past_due` | `grace_period_end` must be in the future | Allow during grace |
| `suspended` | Any | N/A | Deny |
| `cancelled` | Any | N/A | Deny |
| inactive organization | Any | N/A | Deny |

## Entitlements

The current allowlist is:

```text
field_coach_access
lead_management
sales_tracking
provider_integrations
rankings
analytics
native_background_location
admin_controls
```

`field_coach_access` is the base entitlement used by the application bootstrap and the restrictive RLS policies. Feature-specific Edge Functions should additionally assert their narrower entitlement.

## Database enforcement

Every public RLS-enabled table containing `organization_id` receives a restrictive policy named:

```text
organization_subscription_gate
```

That policy is combined with the table's existing organization, role, assignment, ownership, and operation-specific policies. Passing billing does not broaden row access; failing billing denies the row even if another policy would otherwise permit it.

## Client behavior

`app-organization-access-gate.js` loads before the business modules. It intercepts the first `mccoy-access-ready` event for a signed-in user, removes effective access, calls the protected `organization-access` Edge Function, and replays the event only after the server returns `access_allowed=true`.

After that successful verification, repeated Supabase `SIGNED_IN` or `TOKEN_REFRESHED` activity for the same user may cause the authentication shell to replay `mccoy-access-ready`. The gate reuses the successful in-memory verification for the current page lifetime, leaves the application visible, and does not display the full-screen checking dialog again. A different signed-in user or a fresh page load requires a new server verification. Database RLS and service-role entitlement assertions remain authoritative for every business-data operation.

Denied users see a full-screen organization-access message with only:

- `RECHECK ACCESS`
- `SIGN OUT`

No pricing, purchase button, checkout, or external purchase link is displayed in the app.

## Current production organization

McCoy Platform LLC is configured as:

```text
billing_status: internal_unlimited
subscription provider: manual
subscription plan/status: internal_unlimited
seat_limit: unlimited
field_coach_access: enabled
```

The paywall migration does not change leads, assignments, sales, sessions, account approvals, or the organization's current billing state.

## Remaining service-role rollout

RLS protects direct browser/PostgREST operations, and the client blocks normal initialization. Existing service-role Edge Functions bypass RLS by design. Each business function must therefore call `service_assert_organization_access` after validating the user's JWT and before reading or mutating organization data.

Recommended entitlement mapping:

| Function group | Required entitlement |
|---|---|
| lead list, assignment, import, geocoding, field lead actions | `lead_management` |
| provider capture, reconciliation, portal verification | `provider_integrations` |
| sale submit, approvals, customer list, pay progress | `sales_tracking` |
| rankings, company leaders, live wins | `rankings` |
| field analytics, coach summary, session history | `analytics` |
| native background location and session controls | `native_background_location` |
| user, compensation, accounting, metric visibility administration | `admin_controls` |

The paywall is not considered bypass-resistant until all service-role business functions use the assertion and direct suspended-organization calls are tested.
