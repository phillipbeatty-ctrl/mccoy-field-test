# Provider dashboard sale recording

McCoy uses the same capture and verification lifecycle for Quantum ASAP, Brightspeed BASS, AT&T, T-Mobile / T-Fiber, Kinetic, Fidium, Ascend Fiber, Lightcurve, Ripple Fiber, Starlink, DIRECTV, Vivint, and Other.

1. Selecting `SALE` and choosing a provider creates a durable dashboard capture tied to the signed-in rep, provider, field session, and service address.
2. McCoy opens the approved external seller portal without storing or autofilling provider credentials.
   Every provider login opens in a reusable McCoy-managed popup. This shared
   rule also applies to providers connected later. Authentication remains on
   the provider's secure origin; McCoy does not read or store credentials.
3. When the rep returns, McCoy restores the sale form. Reloading McCoy also restores an unfinished capture from the browser, while the server keeps the audit record.
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
