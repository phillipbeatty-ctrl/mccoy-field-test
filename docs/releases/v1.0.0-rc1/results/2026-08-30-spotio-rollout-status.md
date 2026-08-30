# SPOTIO Additive Canonical Import Rollout Status

## Completed

- Production read-only collision plan
- Historical canonicalization and soft-delete audit
- Stable provider/address fallback identity schema
- Canonical upsert functions
- Source alias and import-conflict audit tables
- Active SPOTIO import function update
- Active Lead Pool server query update
- Static RC1 contract test
- Rollback-only canonical upsert pilot

## Pending release acceptance

- Two sequential redacted test uploads with overlap, additions, updates, and omissions
- Repeat-upload idempotency test
- Admin/Manager/Rep visible-count reconciliation after the test imports
- Physical browser confirmation that previous pins remain visible after the second upload

The release-candidate branch must remain unmerged until those pending tests pass.
