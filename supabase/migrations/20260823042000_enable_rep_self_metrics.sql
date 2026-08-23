-- Every active non-Admin user can see their own field metrics by default.
-- Admin can still disable global or per-rep access from Metrics Visibility.
update public.metrics_visibility_settings
set global_rep_metrics_enabled=true, updated_at=now()
where not global_rep_metrics_enabled;

insert into public.rep_metrics_visibility(
  rep_email, rep_metrics_enabled, manager_metrics_enabled, updated_at
)
select lower(a.email), true, true, now()
from public.app_user_access a
where a.active=true and a.role<>'admin'
on conflict (rep_email) do update
set rep_metrics_enabled=true, updated_at=excluded.updated_at;
