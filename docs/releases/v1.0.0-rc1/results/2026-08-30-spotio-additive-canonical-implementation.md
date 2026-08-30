# RC1 SPOTIO Additive Canonical Import — Implementation Record

## Release blocker

Issue: #81 — a newer SPOTIO upload caused older active Lead Pool records to disappear because `list_real_leads` treated the newest normalized SPOTIO batch as the live snapshot. DOM imports also used batch-scoped row identities, creating new copies of the same address during later uploads.

## Architecture now applied

McCoy now treats every import batch as provenance rather than as the membership boundary of the live Lead Pool.

Identity precedence:

1. Stable SPOTIO/provider lead ID when present.
2. Otherwise: organization + SPOTIO source + normalized street + normalized unit + city + state + ZIP.

Each imported SPOTIO row is classified as one of:

- `created`
- `updated`
- `unchanged`
- `collision`
- `quarantined`
- `archived`

A lead omitted from a later upload remains active. Only an explicit authorized archive action removes a live lead.

## Database controls

The production database now contains:

- Organization-scoped SPOTIO import batches.
- Import-result audit rows for every normalized item.
- Stable provider and canonical identity fields on `leads`.
- First-seen, last-seen, and seen-count provenance.
- Unique active SPOTIO constraints for provider identity, canonical identity, and normalized address fallback.
- `mccoy_upsert_spotio_lead_v1` and `mccoy_upsert_spotio_batch_v1` server transactions.
- A read-only canonical merge plan and an audited canonical merge function.

The upsert transaction does not overwrite McCoy operational fields such as:

- Assigned Admin, Manager/Trainer, or Rep
- Disposition, stage, visit result, or attempt count
- Door activity and visit history
- Provider-sale links or sales-record lead links
- Manually or Google-verified coordinates

If a provider ID and normalized address resolve to different active leads, the row is classified as `collision`; neither record is silently merged.

## Historical reconciliation

Before canonicalization, production contained:

- 39,210 active SPOTIO rows
- 15,200 rows with complete service addresses
- 24,010 invalid pseudo-address or incomplete rows
- 10,457 duplicate valid-address rows beyond the canonical records

The read-only merge plan found no conflicting Rep assignment, Manager assignment, disposition, or stage groups among the valid duplicates, and no invalid row with operational visit/sale history.

The audited production reconciliation then:

- Merged and soft-archived 10,457 duplicate SPOTIO rows.
- Quarantined and soft-archived 24,010 invalid import rows.
- Reparented 17 lead-geocode verification records to canonical leads.
- Preserved all door visits, door activities, location events, provider-sale captures, sales-record lead links, and assignment history.
- Left 4,743 active canonical SPOTIO leads.
- Left zero active invalid SPOTIO rows and zero active duplicate normalized-address groups.

Every archived row retains its full lead snapshot and canonical relationship in the removal audit.

## Import behavior

`spotio-import` now:

- Requires an active Admin and organization.
- Stores chunks idempotently by batch/chunk/item position.
- Extracts stable provider IDs from supported SPOTIO key variants.
- Deduplicates repeated rows within the same upload.
- Calls the canonical database upsert in bounded chunks.
- Marks partial, collision-containing, or quarantined imports `incomplete` without hiding existing leads.
- Reports created, updated, unchanged, collision, quarantined, archived, and retained totals.
- Never creates `DOM:<batch_id>:<row_index>` identities.

## Lead Pool visibility

`lead-admin/list_real_leads` no longer filters active leads by the newest SPOTIO `import_batch_id`.

Visibility is now:

- Admin: all active, non-demo leads in the organization.
- Manager/Trainer: only the Admin-assigned Manager pool.
- Rep/Tester: only leads assigned to that Rep under the correct Manager/Admin chain.

`import_batch_id` remains available only to identify the most recent source batch that observed or updated the lead.

## Validation

A rollback-only production pilot tested:

1. An existing assigned lead passed through the canonical upsert.
2. A new synthetic SPOTIO lead was created.
3. The same synthetic lead was submitted again.

The pilot confirmed:

- Existing assignment was preserved.
- Existing disposition and stage were preserved.
- First submission created one lead.
- Repeated submission updated or left unchanged the same lead rather than creating another.
- No synthetic pilot row remained after rollback.

Post-deployment verification confirmed:

- Active canonical SPOTIO leads: 4,743
- Active invalid SPOTIO leads: 0
- Active duplicate normalized-address groups: 0
- Synthetic pilot rows: 0

## Production backend

- `spotio-import`: active, JWT required
- `lead-admin`: active, JWT required

Repository sources and idempotent migrations are committed on `fix/rc1-spotio-additive-canonical-import` so a future rebuild reproduces the production architecture.

## Acceptance test for a real upload

1. Upload A with five unique leads.
2. Assign and disposition at least two leads from A.
3. Upload B containing two new leads, one updated A lead, and omitting two A leads.
4. Confirm the live pool contains seven unique leads.
5. Confirm the omitted A leads remain visible and retain assignments/dispositions.
6. Re-upload B and confirm no new duplicate leads are created.
7. Confirm any invalid/collision rows are reported without hiding or altering prior live leads.

## Rollback and recovery

The canonicalized rows were soft-archived, not hard-deleted. Their snapshots and canonical IDs are retained in `lead_removal_audit`. Import batches and item-level results preserve provenance. A recovery operation can therefore restore a prior record or reassign a dependent reference without relying on the original upload file.
