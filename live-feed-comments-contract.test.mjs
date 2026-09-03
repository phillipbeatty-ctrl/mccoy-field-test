import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8')
const client=read('./app-live-feed.js')
const liveWins=read('./app-live-wins.js')
const worker=read('./service-worker.js')
const migration=read('./supabase/preview-migrations/20260903062000_live_feed_company_team_comments_preview.sql')
const canary=read('./supabase/tests/live-feed-comments-preview-canary.sql')
const docs=read('./docs/live-feed-comments-preview.md')
const publicCommentTable=migration.match(/create table public\.live_feed_comments \(([\s\S]*?)\n\);/)?.[1]||''

test('one consolidated migration makes COMPANY and TEAM scope fail closed',()=>{
  assert.match(migration,/scope = 'company' and scope_id is null/)
  assert.match(migration,/scope = 'team' and scope_id is not null/)
  assert.match(migration,/foreign key \(scope_id, organization_id\)[\s\S]*references public\.teams\(id, organization_id\)/)
  assert.match(migration,/moderation_status text not null default 'pending'/)
  assert.match(migration,/moderation_status = 'approved' and published_at is not null/)
  assert.equal(existsSync(new URL('./supabase/migrations/20260903063000_live_feed_comment_moderation_quarantine.sql',import.meta.url)),false)
})

test('server derives identity and enforces exact role authority',()=>{
  assert.match(migration,/from auth\.users auth_user/)
  assert.match(migration,/v_email <> v_jwt_email[\s\S]*auth_email_mismatch/)
  assert.match(migration,/lower\(access\.email\) = v_email/)
  assert.match(migration,/lower\(membership\.email\) = v_email/)
  assert.match(migration,/lower\(membership\.role\) = lower\(access\.role\)/)
  assert.match(migration,/v_role = 'admin'/)
  assert.match(migration,/v_role in \('manager', 'trainer'\)[\s\S]*team\.manager_user_id = v_profile_user_id/)
  assert.match(migration,/team\.id = v_primary_team_id/)
  assert.match(migration,/company_post_admin_required/)
  assert.match(migration,/team_scope_forbidden/)
  assert.match(migration,/if v_actor\.role <> 'admin' then[\s\S]*admin_required/)
})

test('RLS enforces organization, moderation, and team visibility on the server',()=>{
  assert.match(migration,/private\.live_feed_comment_visible_to_current_user/)
  assert.match(migration,/p_organization_id is distinct from v_actor\.organization_id/)
  assert.match(migration,/p_moderation_status <> 'approved'[\s\S]*p_author_user_id is distinct from v_actor\.auth_user_id[\s\S]*v_actor\.role <> 'admin'/)
  assert.match(migration,/p_scope = 'team'[\s\S]*p_scope_id = any\(v_actor\.readable_team_ids\)/)
  assert.match(migration,/grant select on table public\.live_feed_comments to authenticated/)
  assert.doesNotMatch(migration,/grant (insert|update|delete)[^;]*to authenticated/i)
})

test('free-form text is quarantined and private moderation metadata never reaches Realtime rows',()=>{
  assert.match(migration,/customer_information_not_allowed/)
  assert.match(migration,/customer_data_review_certification_required/)
  assert.match(migration,/private\.live_feed_comment_moderation_events/)
  assert.doesNotMatch(publicCommentTable,/moderation_reason text/)
  assert.doesNotMatch(publicCommentTable,/deleted_by_user_id uuid/)
  assert.match(canary,/private moderation metadata exists on Realtime-readable comment rows/)
})

test('v2 RPCs require explicit scope and retire the organization-wide v1 contract',()=>{
  assert.match(migration,/public\.post_live_feed_comment_v2\([\s\S]*p_scope text,[\s\S]*p_scope_id uuid/)
  assert.match(migration,/public\.get_live_feed_v2\([\s\S]*p_scope text default 'company',[\s\S]*p_scope_id uuid default null/)
  assert.match(migration,/public\.moderate_live_feed_comment_v2/)
  assert.match(migration,/public\.delete_live_feed_comment_v2/)
  assert.match(migration,/drop function if exists public\.post_live_feed_comment_v1/)
  assert.match(client,/post_live_feed_comment_v2/)
  assert.match(client,/get_live_feed_v2/)
  assert.match(client,/moderate_live_feed_comment_v2/)
  assert.match(client,/delete_live_feed_comment_v2/)
  assert.doesNotMatch(client,/post_live_feed_comment_v1|get_live_feed_v1|moderate_live_feed_comment_v1|delete_live_feed_comment_v1/)
})

test('client exposes COMPANY and TEAM choices without using browser-only authorization',()=>{
  assert.match(client,/Choose Company or Team Live Feed/)
  assert.match(client,/function selectedKey[\s\S]*scopeId\|\|''/)
  assert.doesNotMatch(client,/scopeId\|\|'company'/)
  assert.match(client,/scope:'company'/)
  assert.match(client,/scope:'team'/)
  assert.match(client,/state\.scopes\.find\(item=>item\.scope==='team'&&item\.can_post\)/)
  assert.match(client,/p_scope:selected\.scope,p_scope_id:selected\.scope_id\|\|null/)
  assert.match(client,/This feed is read-only for your role/)
  assert.doesNotMatch(client,/filter\([^\n]*team_id[^\n]*\)/i)
})

test('Company feed owns verified sales while Team feed remains comment scoped',()=>{
  assert.match(migration,/from public\.sales_feed feed[\s\S]*where v_scope = 'company'/)
  assert.match(canary,/company sale event leaked into team-comment feed/)
  assert.match(canary,/verified sale missing from Company feed/)
  assert.doesNotMatch(migration,/insert into public\.sales_feed|update public\.sales_feed/i)
  assert.doesNotMatch(migration,/insert into public\.sales_records|update public\.sales_records/i)
})

test('account changes and snapshot-to-Realtime gaps are handled explicitly',()=>{
  assert.match(client,/function resetForIdentity/)
  assert.match(client,/state\.generation\+=1/)
  assert.match(client,/generation!==state\.generation/)
  assert.match(client,/organizationId=String\(access\?\.organization_id/)
  assert.match(client,/`\$\{userId\}\|\$\{email\}\|\$\{organizationId\}\|\$\{role\}\|\$\{active\}`/)
  assert.match(client,/function refreshAuthorization/)
  assert.match(client,/visibilitychange/)
  assert.match(client,/state\.identityKey&&identity\.key&&state\.identityKey!==identity\.key/)
  assert.match(client,/await startRealtime\(\);[\s\S]*await loadFeed/)
  assert.match(client,/if\(state\.loading\)\{state\.reloadQueued=true;return;\}/)
  assert.match(client,/mccoy-account-switch-start/)
  assert.match(client,/mccoy-logout/)
})

test('offline retry preserves normalized body, scope, and request identity',()=>{
  assert.match(client,/state\.pendingRequest=\{id,body,scope:state\.selectedScope,scopeId:state\.selectedScopeId\|\|null\}/)
  assert.match(client,/state\.pendingRequest\.body===body&&state\.pendingRequest\.scope===state\.selectedScope/)
  assert.match(client,/draft saved on this device/)
  assert.match(client,/press RETRY/i)
  assert.match(migration,/client_request_id_reused/)
})

test('canary covers Admin, Manager, Trainer, Rep, team isolation, and cross-organization denial',()=>{
  assert.match(canary,/rep company post was accepted/)
  assert.match(canary,/manager company post was accepted/)
  assert.match(canary,/manager moderation was accepted/)
  assert.match(canary,/trainer moderation was accepted/)
  assert.match(canary,/Admin cross-organization team post was accepted/)
  assert.match(canary,/Team A2 comment leaked into Team A1 feed/)
  assert.match(canary,/cross-team read was accepted/)
  assert.match(canary,/organization A data leaked to organization B/)
  assert.match(canary,/mismatched login email retained Live Feed access/)
  assert.match(canary,/stale JWT retained Live Feed access after auth\.users email changed/)
  assert.match(canary,/^rollback;$/m)
})

test('preview shell and loader request the scoped client version',()=>{
  assert.match(liveWins,/app-live-feed\.js\?v=2026090303/)
  assert.match(worker,/field-coach-app-shell-v11-20260903-live-feed-company-team-preview/)
  assert.match(worker,/'\/app-live-feed\.js\?v=2026090303'/)
})

test('documentation records the exact first-preview authority and no-production guard',()=>{
  assert.match(docs,/Admin[\s\S]*COMPANY or TEAM/i)
  assert.match(docs,/\| Manager \|[\s\S]*authorized teams/i)
  assert.match(docs,/\| Trainer \|[\s\S]*authorized teams/i)
  assert.match(docs,/Rep[\s\S]*TEAM/i)
  assert.match(docs,/Managers and Trainers do not receive moderation authority/i)
  assert.match(docs,/Do not merge/i)
  assert.match(docs,/isolated Supabase branch/i)
})
