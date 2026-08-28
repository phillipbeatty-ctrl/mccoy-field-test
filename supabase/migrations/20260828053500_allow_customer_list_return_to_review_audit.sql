-- Customer List NOT A SALE returns an approved sale to SALE REVIEW and records
-- that lifecycle transition in the same Admin edit history used by edits/approval.
alter table public.sale_admin_edit_history
  drop constraint if exists sale_admin_edit_history_action_check;

alter table public.sale_admin_edit_history
  add constraint sale_admin_edit_history_action_check
  check (action in ('edit','approve','return_to_review'));

comment on constraint sale_admin_edit_history_action_check on public.sale_admin_edit_history is
  'Allowed Admin sale lifecycle audit actions, including returning an approved Customer List sale to SALE REVIEW.';
