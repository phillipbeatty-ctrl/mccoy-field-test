# Issue #81 Transactional Supabase Acceptance

## Scope

- Pull request: #83
- Branch: `fix/81-permanent-lead-identity`
- Supabase project: `athxxrfqxwlfnuvbqadp`
- Date: August 30, 2026
- Execution mode: one rollback-only PostgreSQL transaction

A Supabase preview branch could not be created because database branching is unavailable on the project's current plan. The candidate migration changes and synthetic acceptance data were therefore executed in one transaction against the production schema and explicitly rolled back. No Edge Function was deployed and no live SPOTIO upload was run.

## Compatibility defect found and corrected

The first runtime attempt failed because production defines `public.leads.normalized_address_key` as a stored generated column. The original PR migration tried to assign that column directly, producing PostgreSQL error `428C9`.

Both candidate migrations were corrected so that:

- existing generated columns are left intact;
- fresh schemas define the column as `GENERATED ALWAYS ... STORED`;
- triggers never assign `NEW.normalized_address_key`;
- inserts and updates omit the generated column;
- backfills update only writable identity fields.

Regression coverage was added in `spotio-generated-column-compatibility.test.mjs`.

## Sequential-upload acceptance

The database RPC path passed all ten checks:

| Check | Result | Evidence |
|---|---:|---|
| Upload A creates five leads | PASS | 5 created, 0 updated, 0 collisions |
| Upload B is additive | PASS | 2 created, 1 updated, 2 unchanged, 2 missing-retained; live pool = 7 |
| `import_batch_id` is provenance only | PASS | 5 leads refreshed to B; 2 omitted A leads remained active with older provenance |
| Field state is preserved | PASS | Assignment, disposition, activity, first-seen time, and verified coordinates preserved on two edited leads |
| Re-upload B is idempotent | PASS | 0 created, 0 updated, 5 unchanged, 2 missing-retained |
| Partial/incomplete upload is additive | PASS | 1 unchanged, 6 missing-retained; live pool remained 7 |
| Identity collision is review-only | PASS | 1 collision; lead-state hash unchanged |
| Authorized manual archive is retained | PASS | Archived classification returned; record was not revived |
| Missing provider uses durable namespace | PASS | Fallback identity resolved to `address:spotio|77 default rd||97206` |
| Existing production operational state is unchanged | PASS | Counts and operational hash matched before and after the synthetic sequence |

Overall result: **10 passed, 0 failed**.

## Production invariants observed

The following values matched before and after the acceptance sequence inside the transaction:

- Active SPOTIO leads: **4,743**
- Assigned to Representatives: **2**
- Assigned to Managers: **4,503**
- Dispositioned: **2**
- Verified-coordinate records: **153**
- Operational hash: `5a369d5d61bb77426b67fcd081c6ea6b`

The operational hash covered lead ID, Representative and Manager ownership, Admin ownership, disposition, activity, stage, coordinates, geocode status, and verification status.

## Rollback verification

A separate read-only verification after `ROLLBACK` confirmed:

- no `fallback_identity_key` column persisted;
- no new batch-count columns persisted;
- no missing-retained RPC persisted;
- no synthetic organization persisted;
- no synthetic users persisted;
- no synthetic `app_user_access` row persisted;
- active SPOTIO counts and the operational hash remained unchanged.

## Remaining deployment boundary

This acceptance validates PostgreSQL migration compatibility and database RPC behavior. It does not deploy or invoke the candidate `spotio-import` or `lead-admin` Edge Functions. Production deployment must still apply the reviewed migrations first, deploy both functions with JWT verification enabled, and then run a controlled real upload before unrestricted importing resumes.
