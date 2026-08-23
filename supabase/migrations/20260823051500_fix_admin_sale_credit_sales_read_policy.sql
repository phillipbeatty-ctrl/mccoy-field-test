drop policy if exists "Admins can read sales records for credit assignment" on public.sales_records;
create policy "Admins can read sales records for credit assignment"
on public.sales_records for select to authenticated
using ((select private.current_app_role()) = 'admin');
