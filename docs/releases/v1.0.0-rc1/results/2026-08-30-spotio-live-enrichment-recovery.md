# Verified live SPOTIO enrichment recovery

Date: August 30, 2026

## Why this record exists

An earlier chat response incorrectly claimed that 15,538 SPOTIO records had already been loaded. The Admin Lead Pool still showed 19,240 active non-demo leads because that claimed live load had not actually occurred.

This record documents the subsequently executed production recovery and its fail-closed verification.

## Production result

| Metric | Verified result |
|---|---:|
| Active non-demo leads before recovery | 19,240 |
| Active non-demo leads after recovery | 30,035 |
| Net active increase | 10,795 |
| Active non-demo leads with map coordinates | 30,035 |
| Active non-demo leads without map coordinates | 0 |
| Active SPOTIO leads | 15,538 |
| Active leads with explicit Address 2 / unit values | 1,506 |

## Recovered source identities

| Metric | Verified result |
|---|---:|
| Distinct recoverable source identities | 15,538 |
| Processed source identities | 15,538 |
| New live leads created | 10,795 |
| Existing live leads enriched | 4,743 |
| Existing live leads unchanged | 0 |
| Identity collisions | 0 |
| Quarantined identities | 0 |
| Distinct accepted live lead IDs | 15,538 |
| Accepted live leads with map coordinates | 15,538 |
| Accepted live leads without map coordinates | 0 |

## Source reconciliation

The two capture files declared a combined total of 15,639 records. They contained 15,538 distinct recoverable identities, leaving a source-declared shortfall of 101. No placeholder or invented leads were created for that shortfall.

The failed DOM capture had placed SPOTIO status values in the mapped `address` field. Recovery instead read the actual service address from the stored raw SPOTIO row, retained explicit unit information, and applied the source stage and source timestamp.

## Durable identity and duplicate policy

- The same provider identity enriches the existing durable lead.
- Different provider identities remain separate even when they share a street address.
- Different apartments, suites, buildings, lots, and other units remain separate.
- A provider upload cannot erase a newer McCoy field disposition.
- Existing assignments and verified coordinates remain authoritative.
- Omission from an upload retains the live lead.

## Map visibility

Every active non-demo lead has map coordinates after recovery. Exact or existing building locations were reused where available. Lower-confidence fallback locations are visibly marked for Admin or field review rather than represented as verified door-level placement.

## Runtime validation

A rollback-only production transaction verified that:

1. Two different units at the same street address remain separate.
2. Two different provider IDs at the same address with no unit remain separate.
3. Re-uploading the same provider ID enriches the existing record rather than creating another lead.
4. Updated source stage and phone information are applied to the durable lead.
5. The test transaction leaves no test records after rollback.

The public Admin importer was also verified to serve the new enrichment controls and cache-busted Lead Pool navigation.

## Cleanup

One-use recovery and verification endpoints were retired after verification. Unused encrypted payload fragments were removed. The normal authenticated `spotio-import` function remains live.
