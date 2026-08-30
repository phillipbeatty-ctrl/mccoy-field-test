# RC1 Role Access Result and Rep Lead Pool Blocker

## Build tested

- RC branch: `release/v1.0.0-rc1`
- RC preview deployment: `dpl_8tPPMxR1SuP8MQn9gVqKnjQhMk4L`
- RC preview commit tested: `6f05e171215d2c145078686e4baab1625b6dac33`
- Test date: 2026-08-29 Pacific time

## Role-access result

| Role | Sign-in / refresh | Result |
|---|---|---|
| Manager | Completed normally | PASS |
| Trainer | Completed normally | PASS |
| Rep | Completed normally | PASS for authentication and visible role scope |
| Ghost/test | Completed normally | PASS for authentication and visible role scope |

The maximum reported wait was approximately three seconds. No unexpected Admin controls or cross-role data were reported.

Acceptance **A06 Role access** is recorded as PASS for visible role permissions.

## P1 workflow defect discovered

When the Ghost/test account is assigned the **Rep** role, tapping a Lead Pool map pin does not expose the lead detail/disposition panel, even with no active field session. The same account can access the panel when assigned the Manager role.

- Acceptance impact: **C04 Select distant pin** and the Rep map-disposition workflow
- Severity: **P1 release blocker**
- Tracking issue: **#76**

## Root cause

The Rep/Tester Lead Pool layout expands the map by hiding and making inert the second Lead Pool card. That card contains `mapLeadDetail` and the Activity Type, Visit Result, Stage, and Save controls. Manager Assign mode keeps the card available, explaining the role-dependent result.

## Required retest

After the RC correction, test Ghost/test as Rep on:

1. PC Chrome
2. One physical Apple Safari device

With no active field session, tapping a pin must open the detail/disposition controls while lead-assignment controls remain hidden.
