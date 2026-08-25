# Address Validation Admin Review

This production flow is intentionally separate from automatic repair.

- `address-validation-admin-review` requires a signed-in active McCoy Admin JWT.
- `list` returns only leads in `address_validation_admin_review`.
- `decide` accepts only `keep_original` or `apply_google_candidate` for one lead at a time.
- The database function is service-role-only, protects manual/field-confirmed pins, requires pending review status, validates Google candidate coordinates, and writes an immutable audit before any coordinate update.
- The Lead Pool Admin UI shows original and Google candidate addresses/coordinates, movement distance, validation signals, quarantine reason, and the two explicit decision buttons.
