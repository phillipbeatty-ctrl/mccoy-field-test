# Provider dashboard sale recording

McCoy uses the same capture and verification lifecycle for Quantum ASAP, Brightspeed BASS, AT&T, T-Mobile / T-Fiber, Kinetic, Fidium, Ascend Fiber, Lightcurve, Ripple Fiber, Starlink, DIRECTV, Vivint, and Other.

1. Selecting `SALE` and choosing a provider creates a durable dashboard capture tied to the signed-in rep, provider, field session, and service address.
2. McCoy opens the approved external seller portal without storing or autofilling provider credentials.
3. When the rep returns, McCoy restores the sale form. Reloading McCoy also restores an unfinished capture from the browser, while the server keeps the audit record.
4. Saving the sale links `sales_records.provider_capture_id` to the capture. Reusing the same capture returns the existing sale instead of creating a duplicate.
5. Admin can see open, details-required, recorded, and cancelled captures in Provider Verification.
6. Admin imports an export from any provider dashboard and links each provider seller identity to a McCoy rep.
7. Order/account plus seller identity verification controls `competition_eligible`. A capture alone never counts for rankings or pay-increase tracking.

## Integration boundary

External dashboards are different web origins and cannot be read by McCoy browser code. A completed order can become automatically verified only when the provider supplies an approved API, signed webhook, SFTP/report feed, or export. Until provider transports and credentials are supplied, McCoy guarantees that the attempt and rep-entered sale are not lost, while Admin dashboard-file reconciliation supplies the verification evidence.

Provider usernames, passwords, access tokens, and private keys must never be stored in frontend code or sent through the capture endpoint.
