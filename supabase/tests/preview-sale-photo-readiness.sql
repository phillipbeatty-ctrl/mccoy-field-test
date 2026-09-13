-- Read-only schema/storage inventory for the isolated acceptance branch.
-- Resolve and verify the branch project reference outside SQL before running.
-- This inventories structure only; it does not prove authenticated RLS behavior.
begin read only;
select jsonb_build_object(
  'relations', (
    select jsonb_agg(jsonb_build_object('schema', n.nspname, 'name', c.relname, 'rls_enabled', c.relrowsecurity))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where (n.nspname = 'public' and c.relname in (
      'app_user_access', 'provider_sale_captures', 'provider_sale_capture_photos',
      'sales_records', 'sale_order_photos'
    )) or (n.nspname = 'storage' and c.relname = 'objects')
  ),
  'buckets', (
    select jsonb_agg(jsonb_build_object('name', id, 'public', public,
      'file_size_limit', file_size_limit, 'allowed_mime_types', allowed_mime_types))
    from storage.buckets where id in ('provider-sale-staged-photos', 'sale-order-photos')
  ),
  'photo_policies', (
    select jsonb_agg(jsonb_build_object('schema', schemaname, 'table', tablename,
      'policy', policyname, 'command', cmd, 'roles', roles))
    from pg_policies where (schemaname = 'public' and tablename in (
      'provider_sale_capture_photos', 'sale_order_photos'
    )) or (schemaname = 'storage' and tablename = 'objects')
  )
) as photo_backend_inventory;
rollback;
