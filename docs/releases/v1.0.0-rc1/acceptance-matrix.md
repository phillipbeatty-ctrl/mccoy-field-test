# McCoy Platform v1.0.0-rc1 Acceptance Matrix

## Test record

| Field | Value |
|---|---|
| RC branch | `release/v1.0.0-rc1` |
| RC commit | Update after final RC documentation commit |
| RC Vercel deployment | Pending |
| Supabase project | `athxxrfqxwlfnuvbqadp` |
| Test window | Pending |
| Release owner | Phillip Beatty |
| Result | **NOT STARTED** |

All tests must use the same RC deployment. A test performed against production, an older preview, a restored Safari tab, or a different native build does not count toward RC acceptance.

## Severity

- **P0:** Security, cross-organization exposure, unrecoverable data loss, app unavailable, authentication impossible, or systemic corruption.
- **P1:** Critical business workflow fails, wrong credited user/ranking, sale cannot complete or approve, session stops incorrectly, customer lifecycle becomes inconsistent, or provider evidence attaches to the wrong sale.
- **P2:** Important defect with a safe workaround; defer only with release-owner approval.
- **P3:** Cosmetic or low-risk issue; defer until after `v1.0.0`.

Use one of: `NOT RUN`, `PASS`, `FAIL`, `BLOCKED`, `DEFERRED`.

## Device and role coverage

| ID | Device / browser | Admin | Manager | Trainer | Rep | Ghost/test | Result |
|---|---|:---:|:---:|:---:|:---:|:---:|---|
| D01 | Windows PC · current Chrome | Required | Required | Required | Required | Required | NOT RUN |
| D02 | Physical iPhone · Safari | Required | Optional | Optional | Required | Required | NOT RUN |
| D03 | Physical iPad · Safari portrait | Required | Optional | Optional | Required | Required | NOT RUN |
| D04 | Physical iPad · Safari landscape | Required | Optional | Optional | Required | Required | NOT RUN |
| D05 | Signed TestFlight iPhone build | Required | Optional | Optional | Required | Required | BLOCKED — signing/build required |
| D06 | Signed TestFlight iPad build | Required | Optional | Optional | Required | Required | BLOCKED — signing/build required |

## A. Authentication and access

| ID | Priority | Test | Expected result | Status | Evidence / issue |
|---|---|---|---|---|---|
| A01 | P0 | Fresh sign-in on PC | Login completes without freeze, blank page, or unresponsive tab | NOT RUN | |
| A02 | P0 | Fresh sign-in on iPhone Safari | Login completes and app becomes interactive | NOT RUN | |
| A03 | P0 | Fresh sign-in on iPad Safari | Login completes in portrait and landscape | NOT RUN | |
| A04 | P1 | Forgot-password flow | Authorized user can reset and sign in | NOT RUN | |
| A05 | P1 | Account awaiting Admin approval | User cannot enter protected app until approved | NOT RUN | |
| A06 | P0 | Role access | Admin, Manager, Trainer, Rep, and Tester see only permitted controls | NOT RUN | |
| A07 | P0 | Organization isolation | No role can read or change another organization's leads, sessions, sales, customers, or accounting data | NOT RUN | |
| A08 | P1 | Browser restart recovery | Session restores or requires clean reauthentication without freeze | NOT RUN | |
| A09 | P1 | Multiple-tab behavior | No conflicting active-session, sale, or login state | NOT RUN | |
| A10 | P0 | Sign out | Session tokens and protected UI clear correctly | NOT RUN | |

## B. Field sessions and Admin history

| ID | Priority | Test | Expected result | Status | Evidence / issue |
|---|---|---|---|---|---|
| B01 | P1 | START KNOCKING | Exactly one open field session is created for the user | NOT RUN | |
| B02 | P1 | STOP SESSION | Session ends and reason is `manual_stop` | NOT RUN | |
| B03 | P1 | App switch / screen lock | Web/native behavior matches supported background-mode expectations | NOT RUN | |
| B04 | P1 | Outside assigned area for 29 minutes | Session remains active | NOT RUN | |
| B05 | P1 | Outside assigned area beyond 30 minutes | Session auto-stops on the next control poll, approximately 30:00–30:15 | NOT RUN | |
| B06 | P1 | Return inside before 30 minutes | Continuous outside timer resets; session remains active | NOT RUN | |
| B07 | P1 | Stationary after disposition | Existing idle rule ends session only at its configured threshold | NOT RUN | |
| B08 | P1 | Stale/heartbeat closure | Stale session closes with the correct reason | NOT RUN | |
| B09 | P1 | Sixteen-hour maximum | Session cannot remain open beyond the maximum rule | NOT RUN | |
| B10 | P1 | Admin Daily Session Activity | Calendar day shows user, start, end, duration, status, and exact stop reason | NOT RUN | |
| B11 | P1 | Historical calendar day | Past session records remain reviewable in Pacific time | NOT RUN | |
| B12 | P1 | Cross-midnight session | Selected-day overlap and active-at-day-end values are correct | NOT RUN | |

## C. Lead Pool and map

| ID | Priority | Test | Expected result | Status | Evidence / issue |
|---|---|---|---|---|---|
| C01 | P1 | Open Lead Pool map during active session | Map loads and remains interactive | NOT RUN | |
| C02 | P1 | Pan away from current location | GPS updates move the location marker only; viewport stays put until MY LOCATION is pressed | NOT RUN | Known assessment; correction pending if still reproducible |
| C03 | P1 | Press MY LOCATION | Map centers on current/last valid location | NOT RUN | |
| C04 | P1 | Select distant pin | Selected pin remains selected and map does not snap back | NOT RUN | |
| C05 | P1 | Save distant pin disposition with another door active | Save succeeds and unrelated Sales Hub door remains active | NOT RUN | |
| C06 | P1 | Pin color/history refresh | Selected lead displays the saved Activity Type, Visit Result, Stage, timestamp, and color | NOT RUN | |
| C07 | P1 | Optional Visit dwell timer | Visit dwell is recorded; non-Visit activity records zero dwell | NOT RUN | |
| C08 | P1 | Rapid double save | Exactly one completed map activity and one audit event are created | NOT RUN | |
| C09 | P1 | KNOCK THIS LEAD inside quarter mile | Physical door activity starts | NOT RUN | |
| C10 | P1 | KNOCK THIS LEAD outside quarter mile | Physical knock is blocked; remote disposition and phone sale remain available | NOT RUN | |
| C11 | P1 | Deleted selected lead | Save is rejected safely and Lead Pool refreshes | NOT RUN | |
| C12 | P1 | Reassigned same-organization lead | Disposition succeeds without changing ownership | NOT RUN | |
| C13 | P0 | Cross-organization lead request | Request is denied | NOT RUN | |
| C14 | P1 | Typed phone-sale address match | Matching lead is selected and centered | NOT RUN | |
| C15 | P1 | Typed unmatched address | Map centers on geocoded address without silently creating a lead | NOT RUN | |
| C16 | P1 | Phone sale while distant door active | Completed phone sale does not close unrelated physical-door activity | NOT RUN | |

## D. Sales Hub, provider capture, and photos

| ID | Priority | Test | Expected result | Status | Evidence / issue |
|---|---|---|---|---|---|
| DSA01 | P1 | Provider selection | Current provider is retained for the active session | NOT RUN | |
| DSA02 | P1 | Press PHOTO before SALE | McCoy instructs the user to press SALE first; picker does not open | NOT RUN | |
| DSA03 | P1 | Press SALE | One authoritative provider capture starts | NOT RUN | |
| DSA04 | P1 | Provider dashboard opens | Correct provider route opens without losing McCoy state | NOT RUN | |
| DSA05 | P1 | Return from provider dashboard | McCoy restores the correct capture and Provider Outcome | NOT RUN | |
| DSA06 | P1 | Stage photo on iPhone | iOS offers camera/library/file options and button count updates | NOT RUN | Physical Apple test required |
| DSA07 | P1 | COMPLETE SALE with staged photo | Sale is created and photo attaches to the correct sale | NOT RUN | |
| DSA08 | P1 | ABANDONED with staged photo | No sale is created and staged evidence is deleted | NOT RUN | |
| DSA09 | P1 | Capture retry/idempotency | Repeated Complete does not create duplicate sales | NOT RUN | |
| DSA10 | P1 | Phone-sale explicit context | Capture retains typed/matched address and `source_door_visit_id` remains null | NOT RUN | |
| DSA11 | P1 | Field sale explicit visit context | Only the exact linked active door may close on completion | NOT RUN | |
| DSA12 | P1 | Sales to Complete | Rep can add missing customer/order details before Admin approval | NOT RUN | |

## E. Sale Review, Customer List, and rankings

| ID | Priority | Test | Expected result | Status | Evidence / issue |
|---|---|---|---|---|---|
| E01 | P1 | Admin linear Sale Review feed | All reviewable sales appear once in chronological order | NOT RUN | |
| E02 | P1 | Admin edits customer details | Every sale field can be corrected at any lifecycle stage | NOT RUN | |
| E03 | P1 | Admin changes credited user | Authoritative rankings move to the Admin-selected user | NOT RUN | |
| E04 | P1 | Green APPROVE | Sale leaves Sale Review and appears in Customer List only | NOT RUN | |
| E05 | P1 | Approved customer edit | Admin can correct data without removing it from Customer List | NOT RUN | |
| E06 | P1 | NOT A SALE from Customer List | Sale immediately returns to Admin Review with original processed timestamp | NOT RUN | |
| E07 | P1 | REJECT from Admin Review | Sale moves to recoverable rejected/trash bank | NOT RUN | |
| E08 | P1 | Permanent delete | Only the intended rejected sale is deleted | NOT RUN | |
| E09 | P1 | Order date | Pacific calendar date matches the actual processed sale date | NOT RUN | |
| E10 | P1 | Daily ranking | Sale appears on the correct rep and correct calendar day | NOT RUN | |
| E11 | P1 | Cancellation | Downstream cancellation does not erase the verified processed-order record | NOT RUN | |
| E12 | P0 | Lifecycle consistency | No sale appears simultaneously in incompatible Review, Customer, or rejected states | NOT RUN | |

## F. Provider verification and competition integrity

| ID | Priority | Test | Expected result | Status | Evidence / issue |
|---|---|---|---|---|---|
| F01 | P1 | Linked seller identity | Order/account evidence resolves to the provider seller account linked to the credited McCoy user | NOT RUN | Release gate |
| F02 | P1 | Mismatched seller identity | Sale cannot receive official verified competition credit under another user's credentials | NOT RUN | Release gate |
| F03 | P1 | Provider without real-time API | Sale remains pending/unverified until approved evidence reconciliation | NOT RUN | |
| F04 | P1 | Admin reassignment | Reconciliation and ranking reflect the authoritative Admin-selected credited user | NOT RUN | |
| F05 | P1 | Official competition totals | Only processed-verified orders count; pending evidence is visibly excluded | NOT RUN | |

## G. Accounting and exports

| ID | Priority | Test | Expected result | Status | Evidence / issue |
|---|---|---|---|---|---|
| G01 | P1 | Customer List accounting visibility | Approved verified sales appear once | NOT RUN | |
| G02 | P1 | CSV export | Correct rows, date range, rep filter, and immutable audit hash are produced | NOT RUN | |
| G03 | P1 | Email delivery | Authorized Admin/Accounting user sends attachment through configured company sender | NOT RUN | |
| G04 | P0 | Accounting organization isolation | No export or query includes another organization's data | NOT RUN | |
| G05 | P1 | Cancellation/accounting status | Downstream status updates accounting without rewriting competition history | NOT RUN | |

## H. Reliability, rollback, and release operations

| ID | Priority | Test | Expected result | Status | Evidence / issue |
|---|---|---|---|---|---|
| H01 | P0 | Production page health | Login and primary JavaScript assets return successfully | NOT RUN | |
| H02 | P1 | Vercel runtime errors | No release-blocking error cluster during acceptance | NOT RUN | |
| H03 | P1 | Supabase source parity | Deployed critical Edge Function versions match committed source | NOT RUN | |
| H04 | P1 | Migration reproducibility | Production schema changes are represented by committed migrations | NOT RUN | |
| H05 | P1 | Rollback deployment | Recorded rollback deployment can be restored without database incompatibility | NOT RUN | |
| H06 | P1 | Seventy-two-hour soak | Controlled users complete normal work without P0/P1 incident | BLOCKED — starts after matrix passes | |
| H07 | P1 | Release artifact | Accepted commit is tagged `v1.0.0` with changelog and known limitations | BLOCKED — final step | |

## Failure handling

For every `FAIL`:

1. Create a GitHub issue with the acceptance ID in the title.
2. Record device, role, exact build/deployment, steps, expected result, actual result, screenshot/video, and relevant IDs without customer secrets.
3. Assign P0/P1/P2/P3.
4. Fix on a dedicated branch from `release/v1.0.0-rc1`.
5. Add a regression test where technically possible.
6. Merge only after the failed acceptance case passes on the original device and one second platform.
7. Update this matrix and the release manifest.
