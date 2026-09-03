#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MIGRATION="supabase/preview-migrations/20260903062000_live_feed_company_team_comments_preview.sql"
CANARY="supabase/tests/live-feed-comments-preview-canary.sql"
ARTIFACT_DIR="${LIVE_FEED_VALIDATION_ARTIFACT_DIR:-.artifacts/live-feed-local}"
mkdir -p "$ARTIFACT_DIR"

fail() {
  printf 'Live Feed local validation failed: %s\n' "$*" >&2
  exit 1
}

command -v supabase >/dev/null 2>&1 || fail "Supabase CLI is required."
command -v psql >/dev/null 2>&1 || fail "PostgreSQL psql is required."
[[ -f supabase/config.toml ]] || fail "supabase/config.toml is missing."
[[ -f "$MIGRATION" ]] || fail "$MIGRATION is missing."
[[ -f "$CANARY" ]] || fail "$CANARY is missing."
[[ ! -f "supabase/migrations/$(basename "$MIGRATION")" ]] || fail "The preview migration must remain outside the production migration directory."

status_env="$(supabase status -o env 2>/dev/null)" || fail "The local Supabase stack is not running. Run 'supabase start' first."
db_url="$(printf '%s\n' "$status_env" | sed -nE 's/^DB_URL="?([^"[:space:]]+)"?$/\1/p' | head -n 1)"
[[ -n "$db_url" ]] || fail "Supabase CLI did not report a local DB_URL."

case "$db_url" in
  postgresql://*127.0.0.1:*|postgresql://*localhost:*|postgres://*127.0.0.1:*|postgres://*localhost:*) ;;
  *) fail "Refusing to run preview SQL against a non-local database URL." ;;
esac

PSQL=(psql "$db_url" -X -v ON_ERROR_STOP=1)

printf 'Applying preview migration to the local Docker database only...\n'
"${PSQL[@]}" --single-transaction -f "$MIGRATION" \
  | tee "$ARTIFACT_DIR/migration.log"

relation="$("${PSQL[@]}" -Atqc "select coalesce(to_regclass('public.live_feed_comments')::text,'')")"
[[ "$relation" == "live_feed_comments" || "$relation" == "public.live_feed_comments" ]] \
  || fail "public.live_feed_comments was not created."

rls_enabled="$("${PSQL[@]}" -Atqc "select relrowsecurity::int from pg_class where oid='public.live_feed_comments'::regclass")"
[[ "$rls_enabled" == "1" ]] || fail "Row Level Security is not enabled on public.live_feed_comments."

rpc_count="$("${PSQL[@]}" -Atqc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_live_feed_v2','post_live_feed_comment_v2','moderate_live_feed_comment_v2','delete_live_feed_comment_v2')")"
[[ "$rpc_count" == "4" ]] || fail "Expected all four scoped v2 RPCs."

printf 'Running the rollback-only multi-role canary...\n'
"${PSQL[@]}" -f "$CANARY" | tee "$ARTIFACT_DIR/canary.log"
grep -Eq '(^|[[:space:]])ROLLBACK([[:space:]]|$)' "$ARTIFACT_DIR/canary.log" \
  || fail "The canary did not finish with ROLLBACK."

comment_leaks="$("${PSQL[@]}" -Atqc "select count(*) from public.live_feed_comments where body in ('Rep A1 team update','Manager team update','Trainer team update','Company announcement','Team A2 Admin update')")"
[[ "$comment_leaks" == "0" ]] || fail "Synthetic comment data remained after the canary."

auth_leaks="$("${PSQL[@]}" -Atqc "select count(*) from auth.users where email like 'live-feed-%@preview.invalid'")"
[[ "$auth_leaks" == "0" ]] || fail "Synthetic Auth identities remained after the canary."

cat > "$ARTIFACT_DIR/summary.txt" <<'SUMMARY'
PASS: local Supabase Docker stack only
PASS: preview migration remained outside production migrations
PASS: COMPANY/TEAM schema and scoped v2 RPCs created
PASS: Row Level Security enabled
PASS: rollback-only multi-role canary completed
PASS: synthetic comments and Auth identities rolled back
SUMMARY

cat "$ARTIFACT_DIR/summary.txt"
