# Field Coach billing assessment

## Recommended launch model

Field Coach should launch as **B2B organization software**, not as a consumer subscription app.

- **McCoy internal organization:** `internal_unlimited`, $0, no expiration, no seat billing.
- **External organizations:** paid subscription with active-seat enforcement.
- **Mobile app:** login/access app only; no checkout button or external-payment link in the native app at launch.
- **Billing/admin portal:** web-based direct organizational sales and subscription management.
- **Individual consumer subscriptions:** defer until native Apple In-App Purchase / Google Play Billing is intentionally implemented.

This keeps Field Coach aligned with Apple's enterprise-services rules for software sold directly to organizations and Google's consumption-only model while avoiding unnecessary store billing complexity for the first B2B release.

## Prerequisite: tenant isolation

The current McCoy schema is company-internal and does not yet have a first-class organization/tenant boundary. Do not add a cosmetic paywall before tenant isolation.

Before external sales:

1. Add `organizations`.
2. Add `organization_memberships` with role + active status.
3. Add `organization_subscriptions` and `organization_entitlements`.
4. Seed McCoy as the original organization and migrate all existing McCoy-owned records to it.
5. Add `organization_id` to every tenant-owned table (leads, assignments, teams, sessions, visits, sales, provider/accounting data, configuration, imports, metrics, etc.).
6. Enforce organization isolation in database RLS and server functions, not only the UI.
7. Make the server return an entitlement object at login/session start.
8. Block paid features server-side when subscription/trial entitlement is inactive.

## Initial price positioning

Current field-sales competitors are roughly in the $58–$75 per-user/month range for mainstream field-sales plans. A competitive Field Coach launch price is:

- **Monthly:** $59 per active seat/month.
- **Annual:** $49 per active seat/month, billed annually.
- **Minimum:** 5 active seats per external organization.
- **Pilot:** 14 days, no card required for a sales-assisted company pilot.
- **Enterprise:** custom pricing for SSO, custom provider integrations, SLA, large imports, or dedicated onboarding.

A simple equivalent packaging is **$295/month including 5 seats, then $59/additional active seat**, with annual pricing at **$245/month equivalent including 5 seats, then $49/additional active seat**.

## Paywall behavior

At login, the server should resolve one of:

- `internal_unlimited` — McCoy, always entitled.
- `trial_active` — full trial access until date.
- `paid_active` — full plan entitlement up to purchased active seats.
- `past_due_grace` — short configurable grace period; Admin gets billing warning.
- `suspended` — read/export/admin-billing access only; field tracking and new writes blocked.
- `cancelled` — retained read/export window, then configured archival policy.

Never key the free McCoy bypass to an email domain alone. The bypass should be tied to the immutable McCoy organization record and server-side entitlement.

## Store-distribution note

App name: **Field Coach**. Developer/author branding: **McCoy**. The App Store developer line can be `McCoy` only if the Apple organization account is eligible to select that registered trade/DBA developer name when its first app record is created; the legal seller remains tied to the Apple Developer organization.

## Do not implement yet

Do not merge billing enforcement or external tenant onboarding until the native device pilot passes and the organization migration/RLS plan has its own database test suite.
