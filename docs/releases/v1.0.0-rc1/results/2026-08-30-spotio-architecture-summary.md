# SPOTIO Canonical Lead Architecture

## Identity order

1. Stable SPOTIO/provider lead ID when supplied.
2. Otherwise: organization + source system + normalized street + normalized unit + city + state + ZIP.

## Import behavior

- Imports are additive upserts, not replacement snapshots.
- Leads omitted from a later capture remain active.
- Partial or incomplete uploads cannot hide or archive existing leads.
- Repeated uploads update the same canonical McCoy record.
- `import_batch_id` records provenance only.
- Provider fields refresh without resetting McCoy assignment, disposition, activity, or verified-location fields.
- Non-address DOM rows are rejected rather than inserted as leads.

## Visibility

- Admin: every active non-demo lead in the organization.
- Manager/Trainer: only the Admin-assigned Manager pool.
- Rep/Tester: only the leads assigned to that user through the assigned Manager/Trainer chain.

## Auditability

Source aliases and import-conflict records retain provider identity and collision history. Duplicate and invalid historical rows are soft-deleted with explicit reasons and retained audit snapshots rather than hard-deleted.
