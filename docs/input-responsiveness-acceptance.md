# Field Coach input responsiveness acceptance

Status: implementation and automated regression checks complete; physical-device acceptance pending. This change is prepared for preview testing before production publication.

## Changes

1. Sales Hub uses one layout controller. It places each card only when needed, coalesces layout events, and preserves mounted inputs and selects. The former secondary controller remains in source and is not loaded.
2. Nearest-lead automation stays disabled. Its polling and global input listeners are not installed while paused. The algorithms remain available in source; manual address selection, pin selection, door actions, and any-address sales remain supported.
3. Address matching uses a cached full-address/ID index and reuses the current selection. Lead reloads and address corrections invalidate the index. City, apartment, duplicate-address, and database-identity checks remain intact.
4. Pin colors use direct lead IDs. Relevant map/data events coalesce updates; hidden maps defer painting until visible. Unrelated clicks and periodic color scans no longer trigger work.
5. Dashboard and Sales Hub refreshes share one background timer and company-leaders request. Refreshes preserve customer forms, disposition dropdowns, regional assignments, and Ghost settings. Contact edits are retained per pin; initial reads fill untouched fields, and older reads cannot overwrite a completed save.

## Automated evidence

Run `npm ci --ignore-scripts`, then `npm run test:responsiveness` and `node --test *.test.mjs`.

The responsiveness tests exercise DOM identity, focus, cursor selection, dropdown values, refresh races, and manual sales context. A synthetic 10,000-lead pool verifies that typing resolves once and repeated reads do not rescan unchanged addresses. This is a deterministic DOM/operation-count check, not a measured iPad, iPhone, or Android interaction benchmark.

The broader regression suite covers MOVE PIN, any-address sale/capture completion, provider routing including Ziply, address creation, and existing access constraints. No database, Edge Function, or production configuration change is part of this release.

## Physical-device acceptance

Use the PR preview with a populated authorized lead pool. Record the preview commit, device/OS/browser version, portrait/landscape orientation, and browser versus installed app mode. Reload the preview once before testing so its updated scripts are active.

| Check | Required result | iPad | iPhone | Android |
| --- | --- | --- | --- | --- |
| Open Sales Hub and tap the address once | Cursor appears on the first tap; keyboard stays open | Pending | Pending | Pending |
| Type, select text, move the cursor, and wait at least 70 seconds | Text and cursor remain unchanged during background refresh | Pending | Pending | Pending |
| Open ISP, disposition, and accessible page dropdowns | First tap opens; selection stays stable through refresh | Pending | Pending | Pending |
| Enter a new complete address, including an apartment | ADD ADDRESS and SALE use that exact address; automatic nearest selection stays paused | Pending | Pending | Pending |
| Use the same street in a different city and an existing duplicate address | No silent attachment to a different unit/city/duplicate lead | Pending | Pending | Pending |
| Open, maximize, move around, and hide the map; return to Sales Hub | Inputs remain responsive; map pin colors catch up when reopened | Pending | Pending | Pending |
| Edit customer information, switch pins and return, refresh while typing | Each pin retains its own draft; saved untouched fields load correctly | Pending | Pending | Pending |
| Change a customer field again while its save is pending | Newer edit stays visible and is identified as unsaved | Pending | Pending | Pending |
| Change an authorized region assignment or Ghost setting and wait for refresh | Choice/input remains; another field's changed saved value still updates | Pending | Pending | Pending |
| Verify manual door and designated test-sale flow | Explicit selected address/lead reaches the existing workflow; no accidental second sale | Pending | Pending | Pending |

Use the established test account and test-sale process for write actions. Record any failure with the exact page/control, expected versus actual result, and whether the map or a refresh was active. Automated passing checks do not close this physical-device acceptance gate.
