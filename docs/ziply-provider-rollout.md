# Ziply provider rollout

## Scope

Add canonical provider `Ziply` to the selling selector, provider chooser, ISP
product controls, provider reports, customer review, and photo-pilot selectors.
Use the session-free SaraPlus login with an explicit Ziply account reminder.
Accept `Ziply` and `Ziply Fiber` as Ziply without treating arbitrary unknown
provider names as Ziply or Other. No seller report URL or commission rate is
invented by this change.

## Production prerequisites

The database currently rejects Ziply in `sales_records_isp_check`. The migration
adds only Ziply, preserves all existing provider values, fails if the previously
inspected constraint has changed, and uses bounded lock and statement timeouts.
It does not update existing sales, permissions, RLS, or commissions.

All three deployed consumers of `provider-sale-capture-core.mjs` must receive
the provider addition before the web option is published:

| Function | Inspected live version |
|---|---:|
| provider-sale-capture | 13 |
| sale-submit | 31 |
| provider-reconcile | 18 |

These live functions and their dependency bundles differ from GitHub source.
GitHub entrypoints include organization-paywall wrappers that are not present
in the inspected live bundles. The existing protected deployment workflow
deploys the wider paywall target set, not just the Ziply consumers.

Do not merge the UI first, deploy all paywall targets as a side effect of adding
Ziply, remove source security guards, or bypass the protected release workflow
by deploying downloaded production bundles directly. A reviewed, Ziply-scoped
protected backend release and source/live reconciliation are required first.

## Release order and acceptance

1. Approve and review the narrowly scoped backend release and source reconciliation.
2. Apply and verify the additive ISP constraint migration.
3. Deploy the three approved function bundles with JWT checks retained; verify
   organization, owner, provider, and sale-completion contracts.
4. Merge and publish the UI with the matching Ziply-enabled backend.
5. On an assigned seller account, start a Ziply attempt, verify SaraPlus account
   identity, return, and confirm a legitimate completed order remains labeled
   Ziply in capture, Customer List, and reporting. Do not create fake live sales.

Production database and Edge Functions have not been changed by this source PR.
