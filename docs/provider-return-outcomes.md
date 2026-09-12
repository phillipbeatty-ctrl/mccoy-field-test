# Provider dashboard return outcomes

Prepared September 12, 2026 against main `7e5be837777f7e1f886719def8638b31ee4da12e`.

## Behavior

The Provider Outcome box is removed from Sales Hub. A separate full-screen return screen shows the captured provider and service address, a green check labeled **Sale completed**, and a red X labeled **Abandoned**. A confirmed save closes that screen and returns to Sales Hub. **Resume provider dashboard** reopens the same unfinished attempt.

| Action | Result |
| --- | --- |
| Green check | Submit the existing capture to `sale-submit`; return only after success. |
| Red X | Save `abandoned` through `provider-sale-capture`; create no sale. |
| Close provider tab, return to app, or press Escape | Do not infer an outcome. Require the explicit choice. |
| Save fails or response is lost | Retain the attempt and selected outcome; retry the same icon. |
| Another SALE while an attempt is open | Recover that attempt instead of silently superseding it. |
| Account or organization changes | Dismiss the previous account's controls and ignore its late responses. |

## All eight thinking codes

- **/PLAINLY:** The outcome choices move out of Sales Hub and into the provider-return step. Green records the representative's completed-sale outcome; red records abandonment. Neither choice verifies the provider's order independently.
- **/ATTACK:** Browser-owned chrome cannot be replaced by this web/PWA. Quantum ASAP and Brightspeed BASS returned `X-Frame-Options: SAMEORIGIN`; Vivint restricts embedding to its own and Salesforce origins. The implementation therefore presents the choices after returning to Field Coach. It does not claim to replace the browser's upper-left X. Replacing that toolbar requires a separate supported native browser integration and device validation.
- **/HOLES:** The SaraPlus login response alone does not prove authenticated order-page embedding. Provider login, same-tab Back behavior, installed app behavior, and physical iPad/iPhone/Android acceptance remain to be checked. The environment blocked local browser fixture navigation, so no visual-device pass is claimed.
- **/STEELMAN:** Capturing the outcome at return gives users one clear place to finish, removes the duplicate Sales Hub panel, and keeps the saved provider/address visible before choosing.
- **/SOWHAT:** Users can return and record an outcome without entering customer details again. A failed save remains visible and retryable; browser close never becomes an abandoned sale automatically.
- **/ODDS:** High confidence in the covered JavaScript interaction, retry, account-isolation and cache behavior. Confidence in physical-device navigation and appearance remains unconfirmed until device acceptance.
- **/FAILHOW:** Main failure cases are lost responses, duplicate taps, stale capture recovery, account switching, and prematurely interpreting tab closure as a result. Tests cover these cases. Returning uses a read-only capture lookup so a delayed `mark_returned` write cannot reopen a completed capture.
- **/NEXT:** Review the READY preview on iPad, iPhone and Android. Verify the flow below before approving production. A literal replacement of provider browser chrome needs a separately scoped native implementation.

## Validation and release boundary

The release reuses the deployed `provider-sale-capture` v14 and `sale-submit` v32 APIs. Their live handlers were read to confirm ownership, open-status handling, capture IDs, duplicate-sale behavior and abandonment recovery. No new backend deployment or broader paywall release is needed. No production customer, sale or abandonment records were created for testing.

`provider-return-outcomes.test.mjs` executes the actual router, sales, lifecycle, shared-client and visit-isolation code against a synthetic backend. It covers both outcomes, duplicate clicks, lost successful responses, reload recovery, explicit retry after failed setup, neutral focus, pending-attempt reuse, unrelated door preservation, account switches, and a capture resolved elsewhere. The existing address, input responsiveness, GPS, map, access and sale regressions remain part of validation. The new interaction tests are included in the Manual address sales CI workflow.

The application shell and all changed script references are versioned together as `field-coach-app-shell-v25-20260912-provider-return` and `2026091201`.

## Device acceptance

1. Use a controlled test account/attempt. In Sales Hub confirm there is no Provider Outcome box. Type a service address and select SALE, choose the provider, and open the dashboard.
2. Return using the browser's supported close/Back/app-switch action. Confirm the return screen shows the original provider and address, with separate green and red controls. Check portrait and landscape; nothing may cover either control.
3. For an intended test completion, tap green once. Verify one resulting sale, one ranking update, dismissal of the return screen, and the correct Sales Hub address. Provider evidence and Admin verification remain separate.
4. For a separate intended abandoned attempt, tap red. Verify return to Sales Hub with no new sale or celebration.
5. Interrupt connectivity during a save. Verify a visible retry message, retained address/provider, and no ability to switch to the opposite outcome before confirming the first result. Restore connectivity and retry the same icon; verify no duplicate credit.
6. Reload or reopen Field Coach with an unfinished attempt. Verify recovery for the signed-in user only. Confirm Resume opens the same provider and another SALE does not silently abandon it.
7. With an unrelated door active, complete a phone/unlinked sale and confirm that door remains active. Check focus and unfinished edits after returning, opening the map, and a background refresh.

Platform references: [same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy) and [X-Frame-Options](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Frame-Options).
