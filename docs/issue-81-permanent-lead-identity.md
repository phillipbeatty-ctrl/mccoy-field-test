# Issue #81 — Permanent SPOTIO lead identity

## Goal

A newer provider upload must update the permanent Lead Pool, not replace it.
`import_batch_id` records the latest upload that supplied provider data; it is never used to decide whether an active lead exists or may be assigned.

## Identity precedence

1. `organization_id + provider_lead_id`, when a stable provider lead ID is present.
2. Otherwise: `organization_id + normalized provider + normalized street + normalized unit + ZIP-5`.

City and state remain required import fields and remain part of the normalized display/geocoding address, but they are intentionally excluded from the fallback identity. This prevents city spelling or municipality-boundary corrections from creating a new live lead. When a capture supplies no narrower provider value, the importer uses the durable `SPOTIO` provider namespace rather than an empty identity component.

## Per-upload classifications

| Stored action | Admin meaning | Live-pool effect |
|---|---|---|
| `created` | New lead | Insert one active lead |
| `updated` | Existing lead updated | Refresh provider fields and provenance; preserve field state |
| `unchanged` | Existing lead unchanged | Refresh last-seen/provenance only |
| `collision` | Possible collision requiring review | Do not insert, merge, archive, or overwrite either candidate |
| `missing_retained` | Missing from this upload but retained | Keep the active lead exactly where it is |
| `archived` | Explicitly archived by authorized action | Keep the archived lead archived |

Invalid or incomplete source rows are recorded as `quarantined`; they are import errors, not live-lead classifications.

## Preserved state on update

The database upsert changes provider-controlled fields only. It preserves:

- Representative, Manager, Admin, and team ownership
- Disposition, stage, visit result, and field activity
- Manually verified or Google-validated door coordinates
- Audit history and first-seen timestamp

## Safety controls

- The migration aborts before rewriting keys if the permanent rule reveals any unresolved active collision group.
- Omitted rows are never interpreted as deletions.
- No historical duplicates are merged or archived by this migration.
- A provider-ID match and fallback-address match that point to different active leads is quarantined as a collision.
- Manual archives are not revived by a later upload.
- Production deployment requires a pre-deploy count snapshot and a post-deploy read-only verification before the first new upload.

## Acceptance sequence

1. Upload A with five leads.
2. Assign/disposition two of those leads.
3. Upload B containing two new leads, one changed lead, two unchanged leads, and omitting two leads from A.
4. Confirm the live pool contains seven leads.
5. Confirm B reports: `2 created`, `1 updated`, `2 unchanged`, `2 missing_retained`.
6. Confirm the two field-edited leads retain assignment and disposition.
7. Re-run B and confirm: `0 created`, `0 updated`, `5 unchanged`, `2 missing_retained`; live pool remains seven.
8. Run a partial/incomplete capture and confirm prior active leads remain visible and assignable.
9. Confirm the latest batch ID is returned only as provenance metadata.

## Deployment order

1. Review and merge the source-control PR.
2. Snapshot active SPOTIO counts, assignments, dispositions, manual coordinates, and proposed collision groups.
3. Apply the migration. It must stop on any unresolved collision.
4. Deploy `spotio-import` and `lead-admin` with JWT verification enabled.
5. Run the five-lead acceptance sequence in a controlled organization or test dataset.
6. Only then run the next production SPOTIO upload.

## Rollback boundary

Rolling back the Edge Functions restores the prior API behavior. The migration does not delete or archive active leads; its identity-key rewrite is reversible from provider/address columns. Historical duplicate reconciliation is a separate, explicitly authorized operation and is not part of this change.
