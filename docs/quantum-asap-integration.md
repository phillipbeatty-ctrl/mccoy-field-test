# Quantum ASAP integration — preparation status

Status: **not connected**. No ASAP endpoint, credential, webhook, scheduled job, database migration, or production transport has been configured.

The rep-facing seller-account launcher is prepared in `app-provider-sale-router.js`. Quantum is labeled `Quantum ASAP` and opens the provider-specific login at `https://qfasap.docxtract.com/Login.aspx`. Do not substitute the generic `https://asap.docxtract.com` destination; field testing identified that destination as Lumen ASAP rather than the required Quantum seller account. The launcher runs only after the rep chooses `SALE`; starting a knocking session or switching the session ISP does not open ASAP. Quantum opens in a fresh, full browser tab so the login receives normal keyboard input, including special characters such as `@`, instead of being constrained by an embedded or reused popup. This only opens the portal; it does not connect McCoy to the ASAP API. The launcher relies on the provider's existing browser session or approved SSO and never stores, autofills, or transmits provider credentials.

## What is already compatible

McCoy's existing provider-verification pipeline accepts normalized provider sales, links provider seller identities to McCoy reps, and reconciles order or account identifiers against sales records. ASAP should feed that pipeline; it should not write directly to dashboards, compensation snapshots, or competition results.

## Prepared adapter boundary

`supabase/functions/_shared/quantum-asap-adapter.mjs` converts a mapped ASAP record to the existing provider-row contract:

- provider: always `Quantum`
- order/account identifier
- seller identifier, name, and email
- customer name and service address
- sale date and provider status
- minimal mapped evidence for audit support

The adapter contains no network or database code. It rejects records that lack both an order/account identifier or a seller identity. Credential-like and highly sensitive fields are never copied into `raw_payload`.

`config/quantum-asap-field-map.example.json` is deliberately blank. Actual ASAP field names will only be added from Quantum documentation or a redacted sample export.

## Quantum information required before connection

1. Supported integration method: REST API, webhook, SFTP export, scheduled CSV report, or another approved mechanism.
2. Sandbox or test environment and its base URL.
3. Authentication method and server-side secret requirements.
4. API/report documentation, version, rate limits, retry rules, and allowed IP requirements.
5. A redacted sample payload or CSV with field definitions.
6. Canonical order/confirmation ID, customer account ID, and stable seller identifier.
7. Order status definitions and update/correction behavior.
8. Data-retention and audit requirements for customer information.

Do not send ASAP usernames, passwords, access tokens, or private keys in chat or place them in frontend code. When approved, credentials belong in server-side secrets only.

## Recommended activation sequence

1. Map a redacted ASAP sample through the adapter and confirm accepted/rejected records.
2. Add an idempotency key and unique database constraint so retries cannot duplicate sales rows.
3. Implement the approved server-side transport with strict timeouts and bounded retries.
4. Run in dry-run mode against a sandbox or export with database writes disabled.
5. Compare results with a known Quantum sales report and seller-link roster.
6. Enable database writes for a limited pilot while automatic competition/accounting effects remain disabled.
7. Enable reconciliation only after the pilot matches ASAP totals and statuses.

## Configured Quantum portal

McCoy intentionally opens `https://qfasap.docxtract.com/Login.aspx`, which identifies itself as Quantum Fiber ASAP. Although that page may display a notice referencing the generic ASAP destination, the McCoy launcher must remain pinned to the provider-specific Quantum login unless an administrator supplies and verifies a different Quantum URL.
