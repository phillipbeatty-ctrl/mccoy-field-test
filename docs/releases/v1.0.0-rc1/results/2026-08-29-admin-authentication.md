# RC1 Authentication Result — Admin

## Build

- RC branch: `release/v1.0.0-rc1`
- RC preview deployment: `dpl_8tPPMxR1SuP8MQn9gVqKnjQhMk4L`
- RC preview commit tested: `6f05e171215d2c145078686e4baab1625b6dac33`
- Test date: 2026-08-29 Pacific time
- Role: Admin

## Reported procedure

1. Admin signed out.
2. Admin signed in using Chrome on a Windows PC.
3. Admin signed in using Safari on a physical iPhone.
4. Admin signed in using Safari on a physical iPad.

## Result

| Acceptance ID | Test | Result | Evidence |
|---|---|---|---|
| A01 | Fresh sign-in on PC Chrome | PASS | User reported sign-in completed normally. |
| A02 | Fresh sign-in on physical iPhone Safari | PASS | User reported sign-in completed normally. |
| A03 | Fresh sign-in on physical iPad Safari | PASS for authentication | User reported sign-in completed normally. Portrait and landscape layout coverage remains tracked separately under D03 and D04. |

## Observed outcome

All three devices authenticated successfully. No login freeze, blank page, or unresponsive sign-in screen was reported.

## Remaining authentication/access work

- A04 Forgot-password flow
- A05 Pending-account approval gate
- A06 Role access for Admin, Manager, Trainer, Rep, and Tester
- A07 Cross-organization isolation
- A08 Browser restart recovery
- A09 Multiple-tab/device behavior
- A10 Sign-out token and protected-UI clearing
