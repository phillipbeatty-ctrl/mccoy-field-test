# Provider dashboard sale recording

McCoy uses the same capture and verification lifecycle for Quantum ASAP, Brightspeed BASS, AT&T, T-Mobile / T-Fiber, Kinetic, Fidium, Ascend Fiber, Lightcurve, Ripple Fiber, Starlink, DIRECTV, Vivint, and Other.

1. Selecting `SALE` and choosing a provider creates a durable dashboard capture tied to the signed-in rep, provider, field session, and service address.
2. McCoy opens the approved external seller portal without storing or autofilling provider credentials.
   McCoy persists the capture first and then redirects the current browser tab
   to the provider. This same-tab rule applies to all connected providers,
   including future ones, and avoids mobile and tablet popup blockers.
   Authentication remains on the provider's secure origin; McCoy does not read
   or store credentials.
3. The rep uses browser Back to return to McCoy after processing the order. McCoy automatically restores the unfinished capture and opens the Completed Sale / Abandoned form. Reloading McCoy also restores the capture from the browser, while the server keeps the audit record.
4. Saving the sale links `sales_records.provider_capture_id` to the capture. Reusing the same capture returns the existing sale instead of creating a duplicate.
5. Admin can see open, details-required, recorded, and cancelled captures in Provider Verification.
6. Each rep can import a CSV exported from the same seller account used to process the order. McCoy records the authenticated McCoy user, provider, report period, file digest, and normalized order evidence. Exact duplicate files are ignored.
7. A rep-account match is preliminary evidence only. It sets the sale to pending verification and never unlocks rankings, pay progress, or cancellation adjustments by itself.
8. Admin imports the dealer-level export for each ISP. Every dealer import automatically cross-references covered rep-report rows and surfaces missing or conflicting orders.
9. Dealer order/account plus the Admin-linked seller identity controls `competition_eligible`. A capture or editable rep export alone never counts for rankings or pay-increase tracking.

## Recommended operating cadence

- Reps upload their account report at the end of each selling day or whenever the provider report posts the order.
- Admin imports each ISP's dealer report at least weekly using the exact report coverage dates.
- Admin runs a final cross-reference after the provider's normal posting delay and again at monthly commission close.
- Missing and conflicting rows remain blocked until Admin resolves them against the provider source.

McCoy does not store provider passwords and does not scrape authenticated cross-origin report pages. Direct scheduled ingestion still requires an ISP-approved API, webhook, SFTP feed, or other machine-to-machine export.

## Integration boundary

External dashboards are different web origins and cannot be read by McCoy browser code. A completed order can become automatically verified only when the provider supplies an approved API, signed webhook, SFTP/report feed, or export. Until provider transports and credentials are supplied, McCoy guarantees that the attempt and rep-entered sale are not lost, while Admin dashboard-file reconciliation supplies the verification evidence.

Provider usernames, passwords, access tokens, and private keys must never be stored in frontend code or sent through the capture endpoint.

McCoy does not inject scripts into provider login pages. If a provider's own
cross-origin page rejects keyboard input, the app can reopen it in a clean full
tab and surface recovery instructions, but it cannot bypass or rewrite the
provider's authentication controls.

## Connected seller portals

- Quantum: Quantum ASAP
- Brightspeed: BASS
- AT&T: Sara Plus — AT&T account
- DIRECTV: Sara Plus — DIRECTV account
- Vivint: Vivint Order Entry Tool

AT&T and DIRECTV deliberately use separate McCoy provider contexts even though both
open the stable Sara Plus login route with Submit Orders as its return page:
`https://www.saraplus.com/e/ServicePages/Login.aspx?ReturnUrl=%2fe%2fDealerPages%2fSubmitOrders.aspx`.
After Sara Plus authenticates the rep, it returns that tab to Submit Orders. Each provider gets its own McCoy context and capture,
seller links, report imports, reconciliation, ranking evidence, and accounting evidence.
Because both Sara Plus accounts use the same web origin, the browser can reuse the
other account's Sara Plus cookies across visits. McCoy therefore identifies the
required account before opening Sara Plus and warns when the previously opened context
was the other provider. The rep must sign out of the other Sara Plus account and sign
into the account assigned for the selected provider. McCoy never stores either account's
username or password and cannot isolate or clear Sara Plus cookies.

Never save a copied Sara Plus URL containing `/(S(...))/`. That segment is a temporary
ASP.NET session identifier, not an account-specific order-site address. McCoy strips a
session segment if one is ever supplied and opens the stable Submit Orders route instead.

AT&T, DIRECTV, and Vivint use the same-tab redirect, capture, seller-link, rep-report, dealer-report,
deduplication, ABANDONED exclusion, and Sale Credit review lifecycle as Quantum and
Brightspeed. Their provider exports may be Excel HTML, CSV, or tab-delimited text.
Portal access alone is never proof of a sale and never unlocks rankings or pay.

## Same-tab recovery boundary

McCoy cannot place its own Return button inside a provider's cross-origin site.
The rep returns with browser Back; some provider authentication flows may require
more than one Back action. If the mobile operating system unloads McCoy while the
provider is open, revisiting McCoy restores the locally persisted capture and the
server audit record whenever the initial capture request reached McCoy.
