from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement target, found {count}")
    file_path.write_text(source.replace(old, new, 1), encoding="utf-8")


replace_once(
    "app-live-wins.js",
    """// Preview branch only: load the scoped mixed sale-and-comment Live Feed after
// verified-sale celebration authority is installed, so sales retain priority.
(()=>{
  if(document.querySelector('script[data-mccoy-live-feed-preview]'))return;
  const script=document.createElement('script');
  script.src='app-live-feed.js?v=2026090303';
  script.dataset.mccoyLiveFeedPreview='1';
  document.head.appendChild(script);
})();""",
    """// Preview branch only: load the scoped mixed sale-and-comment Live Feed after
// verified-sale celebration authority is installed, so sales retain priority.
// This browser guard is deliberately separate from the future server rollout flag.
(()=>{
  const PREVIEW_QUERY='mccoy-live-feed-preview';
  const PREVIEW_SESSION_KEY='mccoy-live-feed-preview-enabled';

  function isExplicitNonProductionPreview(){
    const host=String(location.hostname||'').trim().toLowerCase();
    const localHost=host==='localhost'||host==='127.0.0.1'||host==='::1';
    const vercelPreview=host.endsWith('.vercel.app')&&host.includes('-git-');
    if(!localHost&&!vercelPreview)return false;

    const requested=new URLSearchParams(location.search).get(PREVIEW_QUERY)==='1';
    try{
      if(requested)sessionStorage.setItem(PREVIEW_SESSION_KEY,'1');
      return requested||sessionStorage.getItem(PREVIEW_SESSION_KEY)==='1';
    }catch(_){
      return requested;
    }
  }

  if(!isExplicitNonProductionPreview())return;
  if(document.querySelector('script[data-mccoy-live-feed-preview]'))return;
  const script=document.createElement('script');
  script.src='app-live-feed.js?v=2026090303';
  script.dataset.mccoyLiveFeedPreview='1';
  document.head.appendChild(script);
})();""",
)

replace_once(
    "live-feed-comments-contract.test.mjs",
    """test('preview shell and loader request the scoped client version',()=>{
  assert.match(liveWins,/app-live-feed\\.js\\?v=2026090303/)
  assert.match(worker,/field-coach-app-shell-v11-20260903-live-feed-company-team-preview/)
  assert.match(worker,/'\\/app-live-feed\\.js\\?v=2026090303'/)
})""",
    """test('preview loader requires an explicit non-production gate',()=>{
  assert.match(liveWins,/PREVIEW_QUERY='mccoy-live-feed-preview'/)
  assert.match(liveWins,/host==='localhost'\\|\\|host==='127\\.0\\.0\\.1'\\|\\|host==='::1'/)
  assert.match(liveWins,/host\\.endsWith\\('\\.vercel\\.app'\\)&&host\\.includes\\('-git-'\\)/)
  assert.match(liveWins,/if\\(!localHost&&!vercelPreview\\)return false/)
  assert.match(liveWins,/new URLSearchParams\\(location\\.search\\)\\.get\\(PREVIEW_QUERY\\)==='1'/)
  assert.match(liveWins,/if\\(!isExplicitNonProductionPreview\\(\\)\\)return/)
  assert.match(liveWins,/app-live-feed\\.js\\?v=2026090303/)
  assert.match(worker,/field-coach-app-shell-v11-20260903-live-feed-company-team-preview/)
  assert.match(worker,/'\\/app-live-feed\\.js\\?v=2026090303'/)
})""",
)

replace_once(
    "docs/live-feed-comments-preview.md",
    "This branch is a preview-only vertical slice. **Do not merge it and do not deploy its migration to the production Supabase project.** The mandatory first database-backed gate is now **Local Supabase Docker validation**. A paid Supabase Preview Branch is not required.",
    "This branch is a preview-only vertical slice. **Do not merge it and do not deploy its migration to the production Supabase project.** The mandatory first database-backed gate is now **Local Supabase Docker validation**. A paid Supabase Preview Branch is not required.\n\nThe comment client does not load merely because this branch is deployed. It requires both a non-production host (`localhost`, `127.0.0.1`, `::1`, or a git-scoped Vercel preview hostname) and the explicit query flag `?mccoy-live-feed-preview=1`. Production hostnames refuse this preview loader. This browser loading gate is defense in depth and does not replace the required server-enforced one-team rollout flag.",
)

replace_once(
    "docs/live-feed-free-test-plan.md",
    "The same command runs both the Company/Team feature contract and the free-test harness contract once per pull-request update in `.github/workflows/live-feed-local-supabase.yml`, checking out the exact pull-request head. The CI job is a second execution environment, not a replacement for running the command on a controlled developer machine.",
    "The same command runs both the Company/Team feature contract and the free-test harness contract once per pull-request update in `.github/workflows/live-feed-local-supabase.yml`, checking out the exact pull-request head. The CI job is a second execution environment, not a replacement for running the command on a controlled developer machine.\n\nA deployed source preview remains inert by default. To load the comment client, use `?mccoy-live-feed-preview=1` on localhost or a git-scoped Vercel preview hostname. The production hostname cannot enable this preview loader, and this browser gate never substitutes for the later server-enforced controlled-team feature flag.",
)

print("Gated the Live Feed comment client behind an explicit non-production preview flag.")
