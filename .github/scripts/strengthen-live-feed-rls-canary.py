from pathlib import Path

CANARY = Path('supabase/tests/live-feed-comments-preview-canary.sql')
TEST = Path('live-feed-comments-contract.test.mjs')
DOCS = Path('docs/live-feed-comments-preview.md')


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding='utf-8')
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one replacement target, found {count}')
    path.write_text(source.replace(old, new, 1), encoding='utf-8')


replace_once(
    CANARY,
    "  null,null,null,null,null\n);\n\ncreate or replace function pg_temp.live_feed_login",
    "  null,null,null,null,null\n);\n\n-- Policy assertions below switch to the actual authenticated database role.\n-- Grant only SELECT on this transaction-local ID table so those assertions can resolve fixtures.\ngrant select on live_feed_canary_ids to authenticated;\n\ncreate or replace function pg_temp.live_feed_login",
)

replace_once(
    CANARY,
    "  ) then\n    raise exception 'pending team comment leaked to another team member';\n  end if;\nend;\n$$;\n\nselect pg_temp.live_feed_login((select admin_a_auth from live_feed_canary_ids),'live-feed-admin-a@preview.invalid');",
    "  ) then\n    raise exception 'pending team comment leaked to another team member';\n  end if;\nend;\n$$;\nset local role authenticated;\ndo $$\nbegin\n  if exists (\n    select 1 from public.live_feed_comments\n    where id=(select rep_a1_comment from live_feed_canary_ids)\n  ) then raise exception 'pending team comment bypassed RLS for another team member'; end if;\nend;\n$$;\nreset role;\n\nselect pg_temp.live_feed_login((select admin_a_auth from live_feed_canary_ids),'live-feed-admin-a@preview.invalid');",
)

replace_once(
    CANARY,
    "  ) then\n    raise exception 'Admin could not read/moderate a pending team comment';\n  end if;\nend;\n$$;\n\nselect public.moderate_live_feed_comment_v2(",
    "  ) then\n    raise exception 'Admin could not read/moderate a pending team comment';\n  end if;\nend;\n$$;\nset local role authenticated;\ndo $$\nbegin\n  if not exists (\n    select 1 from public.live_feed_comments\n    where id=(select rep_a1_comment from live_feed_canary_ids)\n      and moderation_status='pending'\n  ) then raise exception 'Admin could not read pending team comment through RLS'; end if;\nend;\n$$;\nreset role;\n\nselect public.moderate_live_feed_comment_v2(",
)

replace_once(
    CANARY,
    "  if (company_feed->'context'->>'can_post_company')::boolean then\n    raise exception 'rep received Company posting authority';\n  end if;\nend;\n$$;\n\n-- Approved soft deletion is delivered",
    "  if (company_feed->'context'->>'can_post_company')::boolean then\n    raise exception 'rep received Company posting authority';\n  end if;\nend;\n$$;\nset local role authenticated;\ndo $$\nbegin\n  if not exists (\n    select 1 from public.live_feed_comments\n    where id=(select rep_a1_comment from live_feed_canary_ids)\n      and moderation_status='approved'\n  ) then raise exception 'assigned Team A1 comment missing through authenticated RLS'; end if;\n  if exists (\n    select 1 from public.live_feed_comments\n    where id=(select team_a2_comment from live_feed_canary_ids)\n  ) then raise exception 'Team A2 comment leaked to Team A1 rep through authenticated RLS'; end if;\n  if not exists (\n    select 1 from public.live_feed_comments\n    where id=(select company_comment from live_feed_canary_ids)\n      and moderation_status='approved'\n  ) then raise exception 'Company comment missing through authenticated RLS'; end if;\nend;\n$$;\nreset role;\n\n-- Approved soft deletion is delivered",
)

replace_once(
    CANARY,
    "select pg_temp.live_feed_login((select rep_a1_auth from live_feed_canary_ids),'live-feed-rep-a1@preview.invalid');\ndo $$\nbegin\n  if not exists (\n    select 1 from public.live_feed_comments",
    "select pg_temp.live_feed_login((select rep_a1_auth from live_feed_canary_ids),'live-feed-rep-a1@preview.invalid');\nset local role authenticated;\ndo $$\nbegin\n  if not exists (\n    select 1 from public.live_feed_comments",
)
replace_once(
    CANARY,
    "  ) then raise exception 'soft-deleted comment remained in Team snapshot'; end if;\nend;\n$$;\n\n-- Team A2 rep cannot read Team A1; Company remains readable.",
    "  ) then raise exception 'soft-deleted comment remained in Team snapshot'; end if;\nend;\n$$;\nreset role;\n\n-- Team A2 rep cannot read Team A1; Company remains readable.",
)

replace_once(
    CANARY,
    "-- Team A2 rep cannot read Team A1; Company remains readable.\nselect pg_temp.live_feed_login((select rep_a2_auth from live_feed_canary_ids),'live-feed-rep-a2@preview.invalid');\ndo $$",
    "-- Team A2 rep cannot read Team A1; Company remains readable.\nselect pg_temp.live_feed_login((select rep_a2_auth from live_feed_canary_ids),'live-feed-rep-a2@preview.invalid');\nset local role authenticated;\ndo $$\nbegin\n  if exists (\n    select 1 from public.live_feed_comments\n    where id=(select rep_a1_comment from live_feed_canary_ids)\n  ) then raise exception 'Team A1 tombstone leaked to Team A2 through authenticated RLS'; end if;\n  if not exists (\n    select 1 from public.live_feed_comments\n    where id=(select team_a2_comment from live_feed_canary_ids)\n      and moderation_status='approved'\n  ) then raise exception 'assigned Team A2 comment missing through authenticated RLS'; end if;\nend;\n$$;\nreset role;\ndo $$",
)

replace_once(
    CANARY,
    "-- Tester access is normalized to Rep authority and remains cross-organization isolated.\nselect pg_temp.live_feed_login((select rep_b_auth from live_feed_canary_ids),'live-feed-rep-b@preview.invalid');\ndo $$",
    "-- Tester access is normalized to Rep authority and remains cross-organization isolated.\nselect pg_temp.live_feed_login((select rep_b_auth from live_feed_canary_ids),'live-feed-rep-b@preview.invalid');\nset local role authenticated;\ndo $$\nbegin\n  if exists (\n    select 1 from public.live_feed_comments\n    where organization_id=(select organization_a from live_feed_canary_ids)\n  ) then raise exception 'organization A comment rows leaked to organization B through authenticated RLS'; end if;\nend;\n$$;\nreset role;\ndo $$",
)

replace_once(
    TEST,
    "  assert.match(canary,/approved deletion tombstone was not RLS-readable and redacted/)\n  assert.match(canary,/soft-deleted comment remained in Team snapshot/)",
    "  assert.match(canary,/set local role authenticated/g)\n  assert.match(canary,/reset role/g)\n  assert.match(canary,/pending team comment bypassed RLS for another team member/)\n  assert.match(canary,/Team A2 comment leaked to Team A1 rep through authenticated RLS/)\n  assert.match(canary,/organization A comment rows leaked to organization B through authenticated RLS/)\n  assert.match(canary,/approved deletion tombstone was not RLS-readable and redacted/)\n  assert.match(canary,/soft-deleted comment remained in Team snapshot/)",
)

replace_once(
    DOCS,
    "The canary must roll back all test data and prove:\n",
    "The canary switches to `SET LOCAL ROLE authenticated` for direct-table policy assertions, then restores the privileged migration role for setup and teardown. It must roll back all test data and prove:\n",
)

print('Strengthened the Live Feed canary to exercise RLS as the authenticated database role.')
