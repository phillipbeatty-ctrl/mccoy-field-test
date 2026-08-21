# Brightspeed BASS integration — preparation status

Status: **McCoy capture and reconciliation enabled; direct BASS API not connected**. Opening BASS from `SALE` now creates a durable `provider_sale_captures` record. The rep finishes the McCoy record with the BASS order/account number; it remains excluded from rankings and pay progress until a Brightspeed dashboard export and linked seller identity verify it.

The rep-facing seller-account launcher is in `app-provider-sale-router.js`. Brightspeed is labeled `BASS` and uses `https://bass.docxtract.com/General/SimHomePage.aspx`. The launcher runs only after the rep chooses `SALE`; starting a knocking session or switching the session ISP does not open BASS. It relies on the provider's existing browser session or approved SSO and never stores provider credentials. Because BASS runs on a different web origin, McCoy cannot inspect the BASS page or infer that an order completed. McCoy instead persists the dashboard attempt, restores the sale form when the rep returns, and exposes unfinished attempts in Admin Provider Verification.

Admin Provider Verification links directly to the approved BASS Orders Report at `https://bass.docxtract.com/Report/Orders_Report.aspx`. The downloaded report can be imported and reconciled for all reps. A redacted header row or sample export is still required to replace generic column detection with a locked BASS field map.

## What is already compatible

McCoy has a provider capture and verification pipeline:

1. A dashboard launch is recorded in `provider_sale_captures` for every configured provider.
2. Saving the McCoy sale links `sales_records.provider_capture_id` to that capture.
3. Provider dashboard exports are normalized into `provider_sales_rows`.
4. `provider_seller_links` associates the provider's seller identity with a McCoy rep.
5. Order or account number plus seller identity is reconciled against `sales_records`.
6. Matched sales become `verified_processed`; unmatched sales stay pending, mismatched, or in the low-potential bank and do not count for ranking or pay progress.

BASS should feed this pipeline. It should not write directly to rep dashboards, compensation snapshots, or competition results.

## Prepared adapter boundary

`supabase/functions/_shared/brightspeed-bass-adapter.mjs` converts a mapped BASS record to the existing provider-row contract:

- provider: always `Brightspeed`
- order/account identifier
- seller identifier, name, and email
- customer name and service address
- sale date and provider status
- minimal mapped evidence for audit support

The adapter has no network or database code. It rejects records that lack both an order/account identifier or a seller identity. Credential-like and highly sensitive fields are never copied into `raw_payload`.

`config/brightspeed-bass-field-map.example.json` is deliberately blank. Actual BASS field names will only be added from Brightspeed documentation or a redacted sample export.

## Brightspeed information required before connection

Obtain these items from the Brightspeed channel/partner contact or BASS administrator:

1. Supported integration method: REST API, webhook, SFTP export, scheduled CSV report, or another approved mechanism.
2. Sandbox or test environment and its base URL.
3. Authentication method: OAuth client credentials, service account, mTLS, signed webhook, SFTP key, or another method.
4. API/report documentation, version, rate limits, retry rules, and allowed IP requirements.
5. A redacted sample payload or CSV with field definitions.
6. The canonical order/confirmation ID and customer account ID.
7. The seller identifier that remains stable for each rep.
8. Order status definitions, especially submitted, completed, installed, canceled, and chargeback states.
9. Update behavior: immutable transactions, status updates, corrections, and deletions.
10. Data-retention and audit requirements for customer information.

Do not send BASS usernames, passwords, access tokens, or private keys in chat or place them in frontend code. When approved, credentials belong in server-side secrets only.

## Recommended activation sequence

1. Map a redacted BASS sample through the adapter and confirm accepted/rejected records.
2. Add an idempotency key and unique database constraint so BASS retries cannot duplicate sales rows.
3. Implement the approved server-side transport with strict timeouts and bounded retries.
4. Run in dry-run mode against a sandbox or export with database writes disabled.
5. Compare results with a known Brightspeed sales report and seller-link roster.
6. Enable database writes for a limited pilot while automatic competition/accounting effects remain disabled.
7. Enable reconciliation only after the pilot matches BASS totals and statuses.

## Public-documentation finding

Brightspeed's public API page currently documents LSR Port Out and Universal Order Connect APIs. It does not publish a BASS residential sales-processing API or schema. The public Channel Partner page describes partner sales/provisioning support but does not expose BASS technical integration details.

- https://www.brightspeed.com/business-solutions/api/
- https://www.brightspeed.com/business-solutions/partner/channel-partner-program/
