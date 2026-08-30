# SPOTIO Data Safety

Historical duplicate rows were not hard-deleted. They were soft-deleted with explicit canonical merge or invalid import reasons. Dependent geocode verification records were moved to the selected canonical lead before archival. Existing operational records, assignments, dispositions, and coordinates were preserved according to the canonical selection rules.

Future imports use database upsert functions rather than direct replacement semantics. A lead missing from a partial upload is retained.
