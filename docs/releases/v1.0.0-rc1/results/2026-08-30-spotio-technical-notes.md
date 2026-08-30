# SPOTIO Technical Notes

The active Lead Pool query no longer selects a single newest SPOTIO batch as the live dataset. It reads all active non-demo canonical leads within the caller's organization and assignment scope. Latest batch information is returned only as import provenance metadata.

The importer resolves identity by provider lead ID first and normalized complete service address second. Records without a complete address are rejected from the live lead table. Existing canonical rows are updated through database-controlled merge rules that protect assignment, disposition, activity, and verified placement fields.
