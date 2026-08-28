# Sales Hub provider return and closest lead preview

This preview remains isolated from the production Vercel deployment.

## Provider dashboard return

- Start a provider attempt with SALE.
- Close the provider dashboard using its X control.
- Field Coach should regain focus where the browser permits it and show Provider Outcome.
- The capture is marked returned only for the signed-in user.
- Focus, visibility, page-show, and child-window-close signals are deduplicated.

## Closest McCoy lead

- Leave Lead or Service Address empty.
- Start a field session or open Sales Hub after GPS is available.
- The closest active lead in the current organization is selected regardless of assignment.
- A manually typed or selected address is never overwritten.
- Clearing the address permits a new closest-lead lookup.

## Merge gate

Do not merge the preview pull request until both behaviors have been confirmed on a physical iPhone or iPad together with the PHOTO staging acceptance test.
