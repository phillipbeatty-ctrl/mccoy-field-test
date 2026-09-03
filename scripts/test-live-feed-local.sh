#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_VERSION="${SUPABASE_CLI_VERSION:-2.116.0}"
PROJECT_ID="mccoy-live-feed-local"
WORK_ROOT="${MCCOY_LIVE_FEED_LOCAL_DIR:-${ROOT_DIR}/.tmp/live-feed-local}"
HARNESS_DIR="${WORK_ROOT}/project"
CONFIG_SOURCE="${ROOT_DIR}/tests/live-feed-local/supabase/config.toml"
CONTRACT_SOURCE="${ROOT_DIR}/tests/live-feed-local/supabase/migrations/00000000000000_mccoy_live_feed_contract.sql"
PREVIEW_SOURCE="${ROOT_DIR}/supabase/preview-migrations/20260903062000_live_feed_company_team_comments_preview.sql"
CANARY_SOURCE="${ROOT_DIR}/supabase/tests/live-feed-comments-preview-canary.sql"
DB_CONTAINER=""
DOCKER_NETWORK="${MCCOY_LIVE_FEED_DOCKER_NETWORK:-mccoy-live-feed-local-network}"
DOCKER_NETWORK_CREATED=0

fail() {
  printf 'Live Feed local validation failed: %s\n' "$*" >&2
  exit 1
}

for command_name in docker node npx; do
  command -v "${command_name}" >/dev/null 2>&1 || fail "${command_name} is required"
done

for required_file in "${CONFIG_SOURCE}" "${CONTRACT_SOURCE}" "${PREVIEW_SOURCE}" "${CANARY_SOURCE}"; do
  [[ -f "${required_file}" ]] || fail "missing ${required_file#${ROOT_DIR}/}"
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 22 )) || fail "Node.js 22 or later is required"

docker info >/dev/null 2>&1 || fail "Docker is not running"

if docker network inspect "${DOCKER_NETWORK}" >/dev/null 2>&1; then
  binding_ip="$(docker network inspect --format '{{ index .Options "com.docker.network.bridge.host_binding_ipv4" }}' "${DOCKER_NETWORK}")"
  [[ "${binding_ip}" == "127.0.0.1" ]] || fail "existing Docker network ${DOCKER_NETWORK} is not loopback-bound"
else
  docker network create \
    --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 \
    "${DOCKER_NETWORK}" >/dev/null
  DOCKER_NETWORK_CREATED=1
fi

SUPABASE=(npx --yes "supabase@${CLI_VERSION}")

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  set +e
  if [[ -d "${HARNESS_DIR}" ]]; then
    (
      cd "${HARNESS_DIR}" || exit 0
      "${SUPABASE[@]}" stop --no-backup >/dev/null 2>&1
    )
  fi
  if [[ "${DOCKER_NETWORK_CREATED}" == "1" ]]; then
    docker network rm "${DOCKER_NETWORK}" >/dev/null 2>&1 || true
  fi
  if [[ "${MCCOY_KEEP_LIVE_FEED_LOCAL_FILES:-0}" != "1" ]]; then
    rm -rf "${WORK_ROOT}"
  fi
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

rm -rf "${WORK_ROOT}"
mkdir -p "${HARNESS_DIR}/supabase/migrations" "${HARNESS_DIR}/supabase/tests"
cp "${CONFIG_SOURCE}" "${HARNESS_DIR}/supabase/config.toml"
cp "${CONTRACT_SOURCE}" "${HARNESS_DIR}/supabase/migrations/00000000000000_mccoy_live_feed_contract.sql"
cp "${PREVIEW_SOURCE}" "${HARNESS_DIR}/supabase/migrations/20260903062000_live_feed_company_team_comments_preview.sql"
cp "${CANARY_SOURCE}" "${HARNESS_DIR}/supabase/tests/live-feed-comments-preview-canary.sql"

printf 'Starting isolated local Supabase stack with CLI %s...\n' "${CLI_VERSION}"
(
  cd "${HARNESS_DIR}"
  "${SUPABASE[@]}" start \
    --network-id "${DOCKER_NETWORK}" \
    --exclude studio,imgproxy,storage-api,edge-runtime,logflare,vector,supavisor,postgres-meta,mailpit
)

DB_CONTAINER="$(
  docker ps --format '{{.Names}}' \
    | grep -E "^supabase_db_${PROJECT_ID}$" \
    | head -n 1 \
    || true
)"

if [[ -z "${DB_CONTAINER}" ]]; then
  DB_CONTAINER="$(
    docker ps --format '{{.Names}}' \
      | grep -E '^supabase_db_' \
      | grep -F "${PROJECT_ID}" \
      | head -n 1 \
      || true
  )"
fi

[[ -n "${DB_CONTAINER}" ]] || fail "could not locate the local Supabase Postgres container"

PROJECT_CONTAINERS=()
while IFS= read -r container_name; do
  [[ -n "${container_name}" ]] && PROJECT_CONTAINERS+=("${container_name}")
done < <(docker ps --format '{{.Names}}' | grep -F "_${PROJECT_ID}" || true)
[[ "${#PROJECT_CONTAINERS[@]}" -gt 0 ]] || fail "could not locate local Supabase containers for binding verification"

PUBLISHED_HOST_IPS=()
while IFS= read -r host_ip; do
  [[ -n "${host_ip}" ]] && PUBLISHED_HOST_IPS+=("${host_ip}")
done < <(
  for container_name in "${PROJECT_CONTAINERS[@]}"; do
    docker inspect --format '{{range $port, $bindings := .NetworkSettings.Ports}}{{range $bindings}}{{println .HostIp}}{{end}}{{end}}' "${container_name}"
  done | sed '/^[[:space:]]*$/d' | sort -u
)
[[ "${#PUBLISHED_HOST_IPS[@]}" -gt 0 ]] || fail "local Supabase published no ports to verify"
[[ "${#PUBLISHED_HOST_IPS[@]}" -eq 1 && "${PUBLISHED_HOST_IPS[0]}" == "127.0.0.1" ]] || fail "unsafe local port binding detected: ${PUBLISHED_HOST_IPS[*]}"

printf 'Running rollback canary as privileged setup plus authenticated RLS assertions...\n'
docker exec -i "${DB_CONTAINER}" \
  psql --username postgres --dbname postgres --no-psqlrc --set ON_ERROR_STOP=on \
  < "${HARNESS_DIR}/supabase/tests/live-feed-comments-preview-canary.sql"

row_count="$(docker exec "${DB_CONTAINER}" psql --username postgres --dbname postgres --no-psqlrc --tuples-only --no-align --command "select count(*) from public.live_feed_comments;")"
[[ "${row_count}" == "0" ]] || fail "rollback canary left ${row_count} comment rows"

rls_enabled="$(docker exec "${DB_CONTAINER}" psql --username postgres --dbname postgres --no-psqlrc --tuples-only --no-align --command "select relrowsecurity from pg_class where oid='public.live_feed_comments'::regclass;")"
[[ "${rls_enabled}" == "t" ]] || fail "live_feed_comments RLS is not enabled"

publication_count="$(docker exec "${DB_CONTAINER}" psql --username postgres --dbname postgres --no-psqlrc --tuples-only --no-align --command "select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='live_feed_comments';")"
[[ "${publication_count}" == "1" ]] || fail "live_feed_comments is not in the local Realtime publication"

v1_count="$(docker exec "${DB_CONTAINER}" psql --username postgres --dbname postgres --no-psqlrc --tuples-only --no-align --command "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('post_live_feed_comment_v1','get_live_feed_v1','moderate_live_feed_comment_v1','delete_live_feed_comment_v1');")"
[[ "${v1_count}" == "0" ]] || fail "legacy organization-wide v1 RPCs remain available"

printf '\nLocal Supabase Docker validation passed.\n'
printf '  - production-contract fixture applied\n'
printf '  - COMPANY/TEAM preview migration applied\n'
printf '  - rollback canary passed under authenticated RLS\n'
printf '  - no synthetic comment rows persisted\n'
printf '  - Realtime publication and v2-only contract verified\n'
printf '  - local service ports were bound through a 127.0.0.1-only Docker network\n'
printf '  - no hosted Supabase project was linked or changed\n'
