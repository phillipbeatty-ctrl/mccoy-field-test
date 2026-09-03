from pathlib import Path

CANARY = Path('supabase/tests/live-feed-comments-preview-canary.sql')
CONTRACT = Path('live-feed-comments-contract.test.mjs')
SCRIPT = Path('scripts/test-live-feed-local.sh')
HARNESS = Path('live-feed-local-harness.test.mjs')
DOCS = Path('docs/live-feed-free-test-plan.md')
PREVIEW_DOCS = Path('docs/live-feed-comments-preview.md')


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding='utf-8')
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one replacement target, found {count}')
    path.write_text(source.replace(old, new, 1), encoding='utf-8')


pending_marker = """-- Pending TEAM text is visible to its author and Admin, but not another member in that team.
select pg_temp.live_feed_login((select trainer_a_auth from live_feed_canary_ids),'live-feed-trainer-a@preview.invalid');
"""
pending_replacement = """-- Pending TEAM text is visible to its author and Admin, but not another member in that team.
select pg_temp.live_feed_login((select rep_a1_auth from live_feed_canary_ids),'live-feed-rep-a1@preview.invalid');
do $$
begin
  if not exists (
    select 1 from jsonb_array_elements(public.get_live_feed_v2('team',(select team_a1 from live_feed_canary_ids),100,null)->'events') event
    where event->>'comment_id'=(select rep_a1_comment::text from live_feed_canary_ids)
      and event->>'moderation_status'='pending'
  ) then
    raise exception 'pending author could not read own comment through RPC';
  end if;
end;
$$;
set local role authenticated;
do $$
begin
  if not exists (
    select 1 from public.live_feed_comments
    where id=(select rep_a1_comment from live_feed_canary_ids)
      and author_user_id=(select rep_a1_auth from live_feed_canary_ids)
      and moderation_status='pending'
  ) then raise exception 'pending author could not read own comment through RLS'; end if;
end;
$$;
reset role;

select pg_temp.live_feed_login((select trainer_a_auth from live_feed_canary_ids),'live-feed-trainer-a@preview.invalid');
"""
replace_once(CANARY, pending_marker, pending_replacement)

replace_once(
    CONTRACT,
    "  assert.match(canary,/pending team comment bypassed RLS for another team member/)\n",
    "  assert.match(canary,/pending author could not read own comment through RPC/)\n"
    "  assert.match(canary,/pending author could not read own comment through RLS/)\n"
    "  assert.match(canary,/pending team comment bypassed RLS for another team member/)\n",
)
replace_once(
    CONTRACT,
    "  assert.match(docs,/isolated Supabase branch/i)\n",
    "  assert.match(docs,/Local Supabase Docker validation/i)\n"
    "  assert.doesNotMatch(docs,/Pending paid-preview validation/i)\n",
)

script_source = SCRIPT.read_text(encoding='utf-8')
prelude_start = script_source.index('for command_name in docker node npx; do')
prelude_end = script_source.index('\n\ncleanup() {', prelude_start)
new_prelude = r'''for command_name in docker node npx; do
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

SUPABASE=(npx --yes "supabase@${CLI_VERSION}")'''
script_source = script_source[:prelude_start] + new_prelude + script_source[prelude_end:]
portable_start = script_source.index('mapfile -t PROJECT_CONTAINERS')
portable_end = script_source.index("printf 'Running rollback canary", portable_start)
portable_block = r'''PROJECT_CONTAINERS=()
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

'''
SCRIPT.write_text(script_source[:portable_start] + portable_block + script_source[portable_end:], encoding='utf-8')

replace_once(
    HARNESS,
    "  assert.match(script,/supabase@\\$\\{CLI_VERSION\\}/)\n",
    "  assert.match(script,/supabase@\\$\\{CLI_VERSION\\}/)\n"
    "  assert.match(script,/Node.js 22 or later is required/)\n"
    "  assert.doesNotMatch(script,/\\bmapfile\\b/)\n",
)
replace_once(
    HARNESS,
    "  assert.doesNotMatch(workflow,/supabase\\s+link|db\\s+push|create_branch|project-ref/i)\n",
    "  assert.doesNotMatch(workflow,/supabase\\s+link|db\\s+push|create_branch|project-ref/i)\n"
    "  assert.doesNotMatch(workflow,/\\n  push:/)\n"
    "  assert.match(workflow,/github\\.event_name == 'pull_request'[\\s\\S]*github\\.event\\.pull_request\\.head\\.sha/)\n",
)

replace_once(
    DOCS,
    "- Docker Desktop or another Docker-compatible container runtime\n- Node.js 22 or later\n",
    "- Docker Desktop or another Docker-compatible container runtime\n"
    "- Bash 3.2 or later\n"
    "- Node.js 22 or later\n",
)
replace_once(
    DOCS,
    "The same command runs in `.github/workflows/live-feed-local-supabase.yml`. The CI job is a second execution environment, not a replacement for running the command on a controlled developer machine.\n",
    "The same command runs once per pull-request update in `.github/workflows/live-feed-local-supabase.yml`, checking out the exact pull-request head. The CI job is a second execution environment, not a replacement for running the command on a controlled developer machine.\n",
)
replace_once(
    PREVIEW_DOCS,
    "The same test runs in `.github/workflows/live-feed-local-supabase.yml` so a clean GitHub runner independently repeats the Docker validation.\n",
    "The same test runs once per pull-request update in `.github/workflows/live-feed-local-supabase.yml`, checking out the exact pull-request head so a clean GitHub runner independently repeats the Docker validation without duplicate push-triggered runs.\n",
)

print('Finished pending-author RLS coverage and hardened the free local test path.')
