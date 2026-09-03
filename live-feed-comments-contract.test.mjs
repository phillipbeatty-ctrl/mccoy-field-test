import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const baseMigration=readFileSync(new URL('./supabase/migrations/20260903062000_live_feed_comments_vertical_slice.sql',import.meta.url),'utf8')
const moderationMigration=readFileSync(new URL('./supabase/migrations/20260903063000_live_feed_comment_moderation_quarantine.sql',import.meta.url),'utf8')
const migration=baseMigration+'\n'+moderationMigration
const client=readFileSync(new URL('./app-live-feed.js',import.meta.url),'utf8')
const liveWins=readFileSync(new URL('./app-live-wins.js',import.meta.url),'utf8')
const worker=readFileSync(new URL('./service-worker.js',import.meta.url),'utf8')

function functionBody(name){
  const expression=new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,'gi')
  const matches=[...migration.matchAll(expression)]
  assert.ok(matches.length,`${name} must exist`)
  return matches.at(-1)[0]
}

test('comments are isolated from verified sales and ranking state',()=>{
  assert.match(migration,/create table if not exists public\.live_feed_comments/i)
  assert.doesNotMatch(migration,/alter table public\.sales_feed\s+add column/i)
  assert.doesNotMatch(functionBody('post_live_feed_comment_v1'),/(insert|update|delete)\s+(into\s+|from\s+)?public\.(sales_feed|sales_records)/i)
  assert.doesNotMatch(functionBody('delete_live_feed_comment_v1'),/(insert|update|delete)\s+(into\s+|from\s+)?public\.(sales_feed|sales_records)/i)
  assert.doesNotMatch(client,/MCCOY_REFRESH_RANKINGS|company-leaders|get_verified_sales_rankings/)
  assert.match(client,/mccoy-live-feed-comments-changed/)
  assert.doesNotMatch(client,/dispatchEvent\(new CustomEvent\('mccoy-live-sales-changed'/)
})

test('post RPC derives organization and identity server-side and rejects direct writes',()=>{
  const post=functionBody('post_live_feed_comment_v1')
  assert.match(migration,/private\.live_feed_actor_context\(\)/)
  assert.match(migration,/v_organization_id := private\.current_organization_id\(\)/)
  assert.match(migration,/private\.organization_access_allowed\(v_organization_id, 'field_coach_access'\)/)
  assert.match(migration,/revoke all on table public\.live_feed_comments from public, anon, authenticated/i)
  assert.match(migration,/grant select on table public\.live_feed_comments to authenticated/i)
  assert.doesNotMatch(migration,/grant (insert|update|delete)[^;]*live_feed_comments to authenticated/i)
  assert.match(post,/v_actor\.organization_id/)
  assert.match(post,/v_actor\.auth_user_id/)
  assert.match(post,/v_actor\.display_name/)
  assert.match(post,/v_actor\.role/)
})

test('v1 limits comments, detects customer data, rate-limits, and is idempotent',()=>{
  const post=functionBody('post_live_feed_comment_v1')
  assert.match(migration,/char_length\(btrim\(body\)\) between 1 and 280/)
  assert.match(migration,/live_feed_comment_prohibited_reason/)
  assert.match(migration,/phone_number/)
  assert.match(migration,/email_address/)
  assert.match(migration,/order_or_account_identifier/)
  assert.match(migration,/street_address/)
  assert.match(post,/comment_rate_limited_3_seconds/)
  assert.match(post,/comment_rate_limited_5_per_minute/)
  assert.match(post,/comment_rate_limited_30_per_hour/)
  assert.match(migration,/live_feed_comments\(organization_id, author_user_id, client_request_id\)/)
  assert.match(post,/client_request_id_reused/)
  assert.match(post,/'idempotent', true/)
})

test('mixed feed returns up to 100 sale and comment events from the last 30 days',()=>{
  const getFeed=functionBody('get_live_feed_v1')
  assert.match(getFeed,/from public\.sales_feed feed/)
  assert.match(getFeed,/from public\.live_feed_comments comment/)
  assert.match(getFeed,/union all/)
  assert.match(getFeed,/interval '30 days'/)
  assert.match(getFeed,/least\(coalesce\(p_limit, 100\), 100\)/)
  assert.match(getFeed,/'event_type', 'sale'/)
  assert.match(getFeed,/'event_type', 'comment'/)
  assert.match(getFeed,/feed\.organization_id = v_actor\.organization_id/)
  assert.match(getFeed,/comment\.organization_id = v_actor\.organization_id/)
})

test('comment deletion is soft, audited, and limited to author five minutes or Admin anytime',()=>{
  const remove=functionBody('delete_live_feed_comment_v1')
  assert.match(remove,/v_is_author := v_comment\.author_user_id = v_actor\.auth_user_id/)
  assert.match(remove,/v_is_admin := v_actor\.role = 'admin'/)
  assert.match(remove,/v_comment\.created_at < v_now - interval '5 minutes'/)
  assert.match(remove,/admin_delete_reason_required/)
  assert.match(remove,/insert into private\.live_feed_comment_deletions/)
  assert.match(remove,/update public\.live_feed_comments[\s\S]*deleted_at = v_now/)
  assert.doesNotMatch(remove,/delete from public\.live_feed_comments/)
  assert.doesNotMatch(migration,/create or replace function public\.(edit|update)_live_feed_comment/i)
  assert.match(migration,/live_feed_comment_deletions_immutable/)
  assert.match(client,/deleteDeadline>Date\.now\(\)/)
  assert.match(client,/deleteExpiryTimer=setTimeout/)
  assert.match(client,/five-minute window to remove this comment has expired/)
})

test('version one reserves organization scope and contains no messaging-platform expansion',()=>{
  assert.match(migration,/scope text not null default 'organization'/)
  assert.match(migration,/scope_id uuid/)
  assert.match(migration,/scope = 'organization' and scope_id is null/)
  const table=migration.match(/create table if not exists public\.live_feed_comments \([\s\S]*?\n\);/i)?.[0]||''
  assert.ok(table)
  assert.doesNotMatch(table,/\b(thread_id|parent_comment_id|attachment|reaction|mention|push_token)\b/i)
  assert.doesNotMatch(client,/FileReader|input[^\n]*type=['"]file|Notification\.requestPermission|serviceWorker\.registration\.showNotification/i)
})

test('client renders plain text, preserves explicit offline retry, and suppresses own toasts',()=>{
  assert.match(client,/MAX_COMMENT_LENGTH=280/)
  assert.match(client,/localStorage\.setItem/)
  assert.match(client,/pendingRequest\.body!==bodyText\(state\.draft\)/)
  assert.match(client,/Array\.from\(input\.value\)/)
  assert.doesNotMatch(client,/input\.maxLength=MAX_COMMENT_LENGTH/)
  assert.match(client,/Offline — draft saved on this device\. Reconnect, then press RETRY/)
  assert.match(client,/window\.addEventListener\('online',[\s\S]*press RETRY/)
  assert.doesNotMatch(client,/window\.addEventListener\('online',[\s\S]{0,220}postComment\(/)
  assert.match(client,/message\.textContent=String\(event\.message\|\|''\)/)
  assert.doesNotMatch(client,/innerHTML\s*=/)
  assert.match(client,/ownById/)
  assert.match(client,/ownByEmail/)
  assert.match(client,/ownById\|\|ownByEmail\)return/)
})

test('floating comment notification is nonblocking, downward, auto-expiring, and sale-aware',()=>{
  assert.match(client,/COMMENT_TOAST_DURATION_MS=4000/)
  assert.match(client,/#liveFeedCommentToasts[\s\S]*pointer-events:none/)
  assert.match(client,/@keyframes liveFeedCommentFloat/)
  assert.match(client,/translateY\(118px\)/)
  assert.match(client,/aria-live','polite'/)
  assert.match(client,/prefers-reduced-motion:reduce/)
  assert.match(client,/while\(saleCelebrationActive\(\)\)await wait\(250\)/)
  assert.match(client,/clearCommentToastForSale/)
  assert.match(client,/COMMENT_TOAST_MAX_AGE_MS=15000/)
  assert.match(client,/state\.toastQueue\.length>=3/)
})

test('both legacy Live Wins surfaces are promoted to Live Feed without changing sales authority',()=>{
  assert.match(client,/heading\.textContent='⚡ Live Feed'/)
  assert.match(client,/#salesFeed,#dashboardSalesFeed/)
  assert.match(client,/secondary_messages/)
  assert.match(client,/No Live Feed activity in the last 30 days/)
  assert.match(liveWins,/app-live-feed\.js\?v=2026090302/)
  assert.match(worker,/field-coach-app-shell-v10-20260903-live-feed-moderation-preview/)
  assert.match(worker,/'\/app-live-feed\.js\?v=2026090302'/)
})

test('comments participate in Realtime but authenticated clients receive SELECT only',()=>{
  assert.match(migration,/alter publication supabase_realtime add table public\.live_feed_comments/)
  assert.match(migration,/alter table public\.live_feed_comments replica identity full/)
  assert.match(client,/table:'live_feed_comments'/)
  assert.match(client,/filter:`organization_id=eq\.\$\{organizationId\}`/)
  assert.match(client,/await startRealtime\(\);await loadFeed\(\)/)
  assert.match(client,/SUBSCRIBE_WAIT_EXPIRED/)
})


test('free-form comments are quarantined until an Admin approves them',()=>{
  const post=functionBody('post_live_feed_comment_v1')
  const getFeed=functionBody('get_live_feed_v1')
  const moderate=functionBody('moderate_live_feed_comment_v1')
  assert.match(migration,/moderation_status text not null default 'pending'/)
  assert.match(migration,/moderation_status in \('pending','approved','rejected'\)/)
  assert.match(post,/'pending'/)
  assert.match(getFeed,/comment\.moderation_status = 'approved'/)
  assert.match(getFeed,/comment\.author_user_id = v_actor\.auth_user_id/)
  assert.match(getFeed,/v_actor\.role = 'admin'/)
  assert.match(moderate,/v_actor\.role <> 'admin'/)
  assert.match(moderate,/v_decision not in \('approve','reject'\)/)
  assert.match(moderate,/published_at = v_now/)
  assert.match(moderationMigration,/private\.live_feed_comment_moderation_events/)
  assert.match(moderationMigration,/live_feed_comment_moderation_events_immutable/)
})

test('the client publishes and toasts only after moderation approval',()=>{
  assert.match(client,/Pending Admin approval/)
  assert.match(client,/Submitted for Admin review/)
  assert.match(client,/moderate_live_feed_comment_v1/)
  assert.match(client,/row\.moderation_status!=='approved'/)
  assert.match(client,/row\.moderation_status==='approved'&&old\?\.moderation_status!=='approved'/)
  assert.match(client,/contains no customer names, contact details, addresses, order numbers, account numbers/)
  assert.match(client,/can_moderate/)
})
