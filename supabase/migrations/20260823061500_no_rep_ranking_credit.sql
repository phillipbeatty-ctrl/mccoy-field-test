-- Ranking-only "No rep" credit state. The sale and its accounting owner remain intact.
alter table public.sales_records
  add column if not exists ranking_credit_excluded boolean not null default false,
  add column if not exists ranking_credit_excluded_at timestamptz,
  add column if not exists ranking_credit_excluded_by uuid references auth.users(id) on delete set null,
  add column if not exists ranking_credit_exclusion_reason text,
  add column if not exists sale_credit_review_queued boolean not null default false,
  add column if not exists sale_credit_review_queued_at timestamptz,
  add column if not exists sale_credit_review_queued_by uuid references auth.users(id) on delete set null,
  add column if not exists sale_credit_review_queue_reason text;

comment on column public.sales_records.ranking_credit_excluded is
  'Admin-selected No rep state. Excludes the sale from rankings without changing accounting eligibility or the underlying sale owner.';

create index if not exists sales_records_ranking_credit_excluded_idx
  on public.sales_records(created_at desc)
  where ranking_credit_excluded is true;

create table if not exists public.sale_ranking_credit_history(
  id bigint generated always as identity primary key,
  sale_id uuid not null references public.sales_records(id) on delete restrict,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_by_email text not null,
  action text not null check (action in ('exclude','restore')),
  previous_ranked_rep_user_id uuid,
  previous_ranked_rep_email text,
  previous_ranked_rep_name text,
  new_ranked_rep_user_id uuid,
  new_ranked_rep_email text,
  new_ranked_rep_name text,
  previous_ranking_eligible boolean not null,
  new_ranking_eligible boolean not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists sale_ranking_credit_history_sale_created_idx
  on public.sale_ranking_credit_history(sale_id,created_at desc);
alter table public.sale_ranking_credit_history enable row level security;
revoke all on public.sale_ranking_credit_history from anon;
revoke insert,update,delete,truncate on public.sale_ranking_credit_history from authenticated;
grant select on public.sale_ranking_credit_history to authenticated;
drop policy if exists "Admins can read sale ranking credit history" on public.sale_ranking_credit_history;
create policy "Admins can read sale ranking credit history"
on public.sale_ranking_credit_history for select to authenticated
using ((select private.current_app_role()) = 'admin');

create table if not exists public.sale_credit_review_queue_history(
  id bigint generated always as identity primary key,
  sale_id uuid not null references public.sales_records(id) on delete restrict,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_by_email text not null,
  previous_queued boolean not null,
  new_queued boolean not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists sale_credit_review_queue_history_sale_created_idx
  on public.sale_credit_review_queue_history(sale_id,created_at desc);
alter table public.sale_credit_review_queue_history enable row level security;
revoke all on public.sale_credit_review_queue_history from anon;
revoke insert,update,delete,truncate on public.sale_credit_review_queue_history from authenticated;
grant select on public.sale_credit_review_queue_history to authenticated;
drop policy if exists "Admins can read sale credit review queue history" on public.sale_credit_review_queue_history;
create policy "Admins can read sale credit review queue history"
on public.sale_credit_review_queue_history for select to authenticated
using ((select private.current_app_role()) = 'admin');

-- The exclusion survives provider re-syncs, approval changes, and other later writes.
create or replace function private.enforce_sale_ranking_credit_exclusion()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.ranking_credit_excluded is true then
    new.ranking_eligible := false;
    new.ranking_verified_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_sale_ranking_credit_exclusion() from public,anon,authenticated;
drop trigger if exists sales_records_ranking_credit_exclusion on public.sales_records;
create trigger sales_records_ranking_credit_exclusion
before insert or update of ranking_eligible,ranking_verified_at,ranking_credit_excluded
on public.sales_records
for each row execute function private.enforce_sale_ranking_credit_exclusion();

create or replace function public.admin_apply_sale_credit(
  p_sale_id uuid,
  p_new_rep_email text,
  p_reason text
)
returns public.sales_records
language plpgsql
security definer
set search_path = pg_catalog,public,auth,private
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_before public.sales_records%rowtype;
  v_sale public.sales_records%rowtype;
  v_target_id uuid;
  v_target_email text;
  v_target_name text;
  v_no_rep boolean := nullif(trim(coalesce(p_new_rep_email,'')),'') is null;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select lower(u.email) into v_actor_email
  from auth.users u
  join public.app_user_access a on lower(a.email)=lower(u.email)
  where u.id=v_actor and a.active=true and lower(a.role)='admin';
  if v_actor_email is null then raise exception 'Admin access required'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'A credit reason is required'; end if;

  select * into v_before
  from public.sales_records
  where id=p_sale_id
  for update;
  if not found then raise exception 'Sale not found'; end if;

  if v_no_rep then
    if v_before.ranking_credit_excluded is true then
      raise exception 'Sale already has no rep in rankings';
    end if;

    update public.sales_records set
      ranking_credit_excluded=true,
      ranking_credit_excluded_at=now(),
      ranking_credit_excluded_by=v_actor,
      ranking_credit_exclusion_reason=trim(p_reason),
      ranking_eligible=false,
      ranking_verified_at=null
    where id=p_sale_id
    returning * into v_sale;

    insert into public.sale_ranking_credit_history(
      sale_id,changed_by,changed_by_email,action,
      previous_ranked_rep_user_id,previous_ranked_rep_email,previous_ranked_rep_name,
      new_ranked_rep_user_id,new_ranked_rep_email,new_ranked_rep_name,
      previous_ranking_eligible,new_ranking_eligible,reason
    ) values (
      p_sale_id,v_actor,v_actor_email,'exclude',
      v_before.rep_user_id,v_before.rep_email,v_before.rep_name,
      null,null,null,
      v_before.ranking_eligible,v_sale.ranking_eligible,trim(p_reason)
    );
    return v_sale;
  end if;

  select u.id,lower(u.email),coalesce(nullif(a.display_name,''),split_part(u.email,'@',1))
  into v_target_id,v_target_email,v_target_name
  from auth.users u
  join public.app_user_access a on lower(a.email)=lower(u.email)
  where lower(u.email)=lower(trim(p_new_rep_email)) and a.active=true
  limit 1;
  if v_target_id is null then raise exception 'Target user must have active McCoy access'; end if;
  if v_before.sale_status='not_a_sale' or v_before.admin_review_disposition='not_a_sale' then
    raise exception 'Cannot approve a sale locked as NOT A SALE. Restore the Admin review decision first';
  end if;
  if v_before.required_metrics_complete is not true then
    raise exception 'Cannot approve: missing required sale data: %',array_to_string(v_before.required_metrics_missing,', ');
  end if;

  if v_before.rep_user_id<>v_target_id then
    perform public.admin_reassign_sale_credit(p_sale_id,v_target_id,p_reason);
  end if;
  select * into v_sale from public.sales_records where id=p_sale_id;

  update public.sales_records set
    credit_assigned_by=v_actor,
    credit_assigned_at=now(),
    credit_assignment_reason=trim(p_reason),
    compensation_snapshot=jsonb_set(
      coalesce(compensation_snapshot,'{}'::jsonb),
      '{admin_approval}',
      jsonb_build_object('status','approved','approved_by',v_actor_email,'approved_at',now(),'reason',trim(p_reason)),
      true
    ),
    admin_review_disposition=null,
    admin_review_reason='Approved through Sale Credit: '||trim(p_reason),
    admin_reviewed_by=v_actor,
    admin_reviewed_at=now(),
    verification_status='verified_processed',
    verification_reason='admin_approved_sale_credit: '||trim(p_reason),
    verified_at=coalesce(verified_at,now()),
    ranking_credit_excluded=false,
    ranking_credit_excluded_at=null,
    ranking_credit_excluded_by=null,
    ranking_credit_exclusion_reason=null,
    ranking_eligible=true,
    competition_eligible=case when sale_status in ('cancelled','charged_back') then false else true end,
    ranking_verified_at=coalesce(ranking_verified_at,verified_at,now())
  where id=p_sale_id
  returning * into v_sale;

  if v_before.ranking_credit_excluded is true then
    insert into public.sale_ranking_credit_history(
      sale_id,changed_by,changed_by_email,action,
      previous_ranked_rep_user_id,previous_ranked_rep_email,previous_ranked_rep_name,
      new_ranked_rep_user_id,new_ranked_rep_email,new_ranked_rep_name,
      previous_ranking_eligible,new_ranking_eligible,reason
    ) values (
      p_sale_id,v_actor,v_actor_email,'restore',
      null,null,null,
      v_target_id,v_target_email,v_target_name,
      v_before.ranking_eligible,v_sale.ranking_eligible,trim(p_reason)
    );
  end if;

  insert into public.sale_review_disposition_history(
    sale_id,changed_by,changed_by_email,previous_disposition,new_disposition,
    previous_verification_status,new_verification_status,previous_sale_status,new_sale_status,
    previous_ranking_eligible,new_ranking_eligible,reason
  ) values (
    p_sale_id,v_actor,v_actor_email,v_before.admin_review_disposition,v_sale.admin_review_disposition,
    v_before.verification_status,v_sale.verification_status,v_before.sale_status,v_sale.sale_status,
    v_before.ranking_eligible,v_sale.ranking_eligible,'Admin approved Sale Credit: '||trim(p_reason)
  );

  return v_sale;
end;
$$;
revoke all on function public.admin_apply_sale_credit(uuid,text,text) from public,anon;
grant execute on function public.admin_apply_sale_credit(uuid,text,text) to authenticated;

create or replace function public.admin_approve_sale_credit(
  p_sale_id uuid,
  p_rep_email text,
  p_reason text
)
returns public.sales_records
language sql
security definer
set search_path = pg_catalog,public
as $$
  select public.admin_apply_sale_credit(p_sale_id,p_rep_email,p_reason);
$$;
revoke all on function public.admin_approve_sale_credit(uuid,text,text) from public,anon;
grant execute on function public.admin_approve_sale_credit(uuid,text,text) to authenticated;

create or replace function public.admin_set_sale_credit_review_queue(
  p_sale_id uuid,
  p_queued boolean,
  p_reason text
)
returns public.sales_records
language plpgsql
security definer
set search_path = pg_catalog,public,auth,private
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_before public.sales_records%rowtype;
  v_sale public.sales_records%rowtype;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  select lower(u.email) into v_actor_email
  from auth.users u join public.app_user_access a on lower(a.email)=lower(u.email)
  where u.id=v_actor and a.active=true and lower(a.role)='admin';
  if v_actor_email is null then raise exception 'Admin access required'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'A review queue reason is required'; end if;

  select * into v_before from public.sales_records where id=p_sale_id for update;
  if not found then raise exception 'Sale not found'; end if;
  if p_queued is true and v_before.verification_status<>'verified_processed' then
    raise exception 'Only verified sales can be added to the review queue';
  end if;
  if v_before.sale_credit_review_queued is not distinct from coalesce(p_queued,false) then
    if p_queued then
      raise exception 'Sale is already in the review queue';
    else
      raise exception 'Sale is not in the review queue';
    end if;
  end if;

  update public.sales_records set
    sale_credit_review_queued=coalesce(p_queued,false),
    sale_credit_review_queued_at=case when p_queued then now() else null end,
    sale_credit_review_queued_by=case when p_queued then v_actor else null end,
    sale_credit_review_queue_reason=case when p_queued then trim(p_reason) else null end
  where id=p_sale_id returning * into v_sale;

  insert into public.sale_credit_review_queue_history(
    sale_id,changed_by,changed_by_email,previous_queued,new_queued,reason
  ) values (
    p_sale_id,v_actor,v_actor_email,v_before.sale_credit_review_queued,v_sale.sale_credit_review_queued,trim(p_reason)
  );
  return v_sale;
end;
$$;
revoke all on function public.admin_set_sale_credit_review_queue(uuid,boolean,text) from public,anon;
grant execute on function public.admin_set_sale_credit_review_queue(uuid,boolean,text) to authenticated;

-- Extend the existing Sale Credit source; do not create a second dashboard path.
create or replace function public.admin_sale_credit_dashboard_page(
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog,public,auth,private
as $$
declare
  v_actor uuid := auth.uid();
  v_limit integer := greatest(1,least(coalesce(p_limit,100),250));
  v_offset integer := greatest(0,coalesce(p_offset,0));
  v_total integer;
  v_rows jsonb;
begin
  if v_actor is null or not exists (
    select 1
    from auth.users u
    join public.app_user_access a on lower(a.email)=lower(u.email)
    where u.id=v_actor and a.active=true and lower(a.role)='admin'
  ) then raise exception 'Admin access required'; end if;

  select count(*)::integer into v_total from public.sales_records;
  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
  into v_rows
  from (
    select s.created_at,jsonb_build_object(
      'sale',to_jsonb(s),
      'region',coalesce(nullif(a.team_name,''),'Unassigned'),
      'provider_account',case when p.id is null then null else to_jsonb(p) end,
      'credit_history',coalesce((
        select jsonb_agg(to_jsonb(h) order by h.created_at desc)
        from public.sale_credit_assignment_history h where h.sale_id=s.id
      ),'[]'::jsonb),
      'ranking_credit_history',coalesce((
        select jsonb_agg(to_jsonb(rh) order by rh.created_at desc)
        from public.sale_ranking_credit_history rh where rh.sale_id=s.id
      ),'[]'::jsonb),
      'review_queue_history',coalesce((
        select jsonb_agg(to_jsonb(qh) order by qh.created_at desc)
        from public.sale_credit_review_queue_history qh where qh.sale_id=s.id
      ),'[]'::jsonb),
      'review_history',coalesce((
        select jsonb_agg(to_jsonb(r) order by r.created_at desc)
        from public.sale_review_disposition_history r where r.sale_id=s.id
      ),'[]'::jsonb)
    ) as row_data
    from public.sales_records s
    left join public.provider_sales_rows p on p.id=s.provider_sale_row_id
    left join public.app_user_access a on lower(a.email)=lower(s.rep_email)
    order by s.created_at desc
    limit v_limit offset v_offset
  ) page;

  return jsonb_build_object(
    'ok',true,'total_count',v_total,'offset',v_offset,'limit',v_limit,'rows',v_rows
  );
end;
$$;
revoke all on function public.admin_sale_credit_dashboard_page(integer,integer) from public,anon;
grant execute on function public.admin_sale_credit_dashboard_page(integer,integer) to authenticated;
