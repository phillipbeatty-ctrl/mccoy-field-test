# Provider report cross-reference

The report pipeline uses two evidence levels:

| Evidence | Uploaded by | Purpose | Can unlock ranking/pay? |
| --- | --- | --- | --- |
| Rep seller-account report | Authenticated rep | Quickly corroborates orders visible in the account used to process them | No |
| Dealer-level ISP report | Admin using the dealer/corporate account | Authoritative verification and cancellation source | Yes, after linked seller identity and outside-system approval rules pass |

Every import records its provider, source scope, authenticated uploader, optional report coverage dates, row counts, and SHA-256 file digest. Re-uploading the same file for the same provider and source account does not create duplicate rows.

Dealer imports automatically compare their covered orders with rep-account rows:

- `matched_dealer`: order/account appears in both sources without a comparable seller conflict.
- `missing_from_dealer`: rep evidence falls inside the dealer report period but is absent from the dealer file.
- `conflict`: order/account exists in both, but a comparable seller field disagrees.
- `pending_dealer`: rep evidence has not yet been covered by a dealer import.

Missing and conflicting evidence is shown in Admin Provider Verification and remains ineligible. Exact report-period dates are required before absence is treated as a discrepancy; this prevents a partial dealer export from falsely rejecting older or newer sales.

Report files are treated as untrusted input. Credential-, token-, Social Security-, bank-, card-, CVV-, and PIN-like columns are stripped from stored raw payloads. Provider credentials are never stored.
