-- Cover Ghost settings audit foreign keys reported by the database advisor.
create index if not exists ghost_ranking_settings_updated_by_idx
  on public.ghost_ranking_settings (updated_by)
  where updated_by is not null;

create index if not exists ghost_ranking_setting_changes_changed_by_idx
  on public.ghost_ranking_setting_changes (changed_by);
