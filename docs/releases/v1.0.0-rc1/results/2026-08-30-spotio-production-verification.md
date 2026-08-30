# RC1 SPOTIO Production Verification

Production verification after canonicalization and function deployment:

- Active canonical SPOTIO leads: 4,743
- Manager-assigned canonical leads: 4,503
- Rep-assigned canonical leads: 2
- Canonical leads with operational history: 68
- Canonical leads with coordinates: 4,493
- Invalid active SPOTIO rows: 0
- Merged duplicate rows: 10,457
- Quarantined invalid/non-address rows: 24,010
- Lead geocode verification rows reparented: 17

The canonicalization was preceded by a read-only plan. The plan reported no conflicting Rep assignment groups, no conflicting Manager assignment groups, no conflicting disposition groups, and no invalid rows with operational history.

The `spotio-import` Edge Function is active at version 12 with JWT verification. The `lead-admin` Edge Function is active at version 21 with JWT verification and lists active non-demo leads by organization and assignment scope rather than by newest import batch.

A rollback-only canonical upsert pilot verified that an existing address updates the existing canonical lead while retaining assignment and disposition, and a new address creates one canonical lead. The pilot transaction was rolled back and left no test lead.
