# Admin sale edit numeric/boolean mismatch

`public.sales_records.commission_chargeback_applied` is a non-null `numeric` column with a default of `0`.

The prior `admin_edit_any_sale` implementation attempted to use a Boolean expression for that column inside a `CASE`, which caused every Admin sale edit to fail at statement planning with:

`CASE types numeric and boolean cannot be matched`

The migration `20260827175500_fix_admin_sale_edit_chargeback_type.sql` keeps the field numeric and preserves all existing Admin authorization, organization isolation, row locking, allow-listing, and before/after audit behavior.
