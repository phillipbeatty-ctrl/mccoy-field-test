# Issue #81 Guarded Production Rollout

## Release source

- Pull request: #83
- Release branch: `release/v1.0.0-rc1`
- Merge commit: `37ddff430f4acb959c0849c095f0eb21467182e5`
- Production project: `athxxrfqxwlfnuvbqadp`
- Rollout date: August 30, 2026

PR #83 was merged before any production upload was initiated.

## Fresh production preflight

The pre-deployment snapshot completed at `2026-08-30T18:17:53.333378Z`.

| Invariant | Pre-deploy value |
|---|---:|
| Active SPOTIO leads | 4,743 |
| Leads with provider ID | 66 |
| Fallback-identity leads | 4,677 |
| Assigned to Representatives | 2 |
| Assigned to Managers | 4,503 |
| Dispositioned | 2 |
| Canonical collision groups | 0 |
| Fallback collision groups | 0 |
| Operational hash | `f01d3265a9d2abe0c51792d70ef87286` |

The operational hash covers lead ID, Representative ownership, Manager ownership, Admin ownership, disposition, activity, visit result, stage, coordinates, geocode status, and coordinate-verification status.

## Production migrations

The merged migrations were applied in order and both completed successfully:

1. `spotio_permanent_lead_identity_20260830070000`
   - Production migration version: `20260830181959`
2. `spotio_default_provider_namespace_20260830070001`
   - Production migration version: `20260830182117`

Post-migration verification confirmed:

- `fallback_identity_key` exists.
- `missing_retained_count` exists.
- `mccoy_upsert_spotio_batch_v1` exists.
- `mccoy_classify_spotio_missing_retained_v1` exists.
- Active provider-ID and canonical-identity unique indexes exist.

## Edge Function deployment

| Function | Production version | JWT verification | Deployed SHA-256 |
|---|---:|---:|---|
| `spotio-import` | 14 | Enabled | `be4354c4e1e95c73941dfa323ba4cf32c7ae865c11422423bb89cc170e9715f2` |
| `lead-admin` | 23 | Enabled | `179e5ef09293ccc0d25fae280e8cac90c154eb09a84b5f0e6b8fd4db6b092772` |

## Exactly one controlled production upload

The acceptance upload ran through the deployed `spotio-import` v14 endpoint using an isolated temporary organization. It did not share tenant scope with McCoy's existing 4,743 SPOTIO leads.

- Workflow run: `33328262794`
- Controlled batch: `c858f074-b4d7-44a4-a92c-210c25aa8049`
- Source metadata: `issue81_controlled_production_acceptance`
- Input rows: 5
- Provider-ID rows: 4
- Fallback-identity rows: 1

| Classification | Count |
|---|---:|
| Created | 5 |
| Updated | 0 |
| Unchanged | 0 |
| Collision | 0 |
| Quarantined | 0 |
| Missing retained | 0 |
| Explicitly archived | 0 |
| Capture missing | 0 |
| Duplicate input | 0 |

`lead-admin` v23 independently returned the isolated five-lead pool, the controlled batch as latest provenance, and `import_batch_is_provenance_only: true`.

The first runner attempt stopped during temporary-account setup before `spotio-import` initialization. Database verification showed zero acceptance batches before the successful run. The successful run created exactly one batch.

## Post-deploy production verification

The final snapshot completed at `2026-08-30T18:32:00.981791Z`.

| Invariant | Before | After |
|---|---:|---:|
| Active SPOTIO leads | 4,743 | 4,743 |
| Leads with provider ID | 66 | 66 |
| Fallback-identity leads | 4,677 | 4,677 |
| Assigned to Representatives | 2 | 2 |
| Assigned to Managers | 4,503 | 4,503 |
| Dispositioned | 2 | 2 |
| Canonical collision groups | 0 | 0 |
| Fallback collision groups | 0 | 0 |
| Operational hash | `f01d3265a9d2abe0c51792d70ef87286` | `f01d3265a9d2abe0c51792d70ef87286` |

No existing assignment, disposition, activity, stage, coordinate, geocode status, or verification status changed during the rollout.

## Evidence and cleanup

- GitHub artifact: `issue81-one-controlled-production-upload`
- Artifact ID: `9736877817`
- Artifact digest: `sha256:0f939d3150e3a21c29dfb3806963904b87e008b0fdf0df215b786e47c909219b`
- Artifact expiration: September 13, 2026

After evidence capture, the isolated five leads, batch, results, temporary organization, public user profile, access record, and Auth account were deleted. A read-back confirmed zero remaining acceptance rows.

## Result

The permanent additive SPOTIO identity system is deployed. `import_batch_id` is provenance only, omitted leads are retained, collisions fail safe, and the deployed importer plus Lead Pool endpoint passed a real authenticated production-path acceptance upload without changing McCoy's existing live SPOTIO pool.
