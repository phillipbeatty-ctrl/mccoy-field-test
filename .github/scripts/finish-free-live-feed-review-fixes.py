from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement target, found {count}")
    file_path.write_text(source.replace(old, new, 1), encoding="utf-8")


CLIENT = "app-live-feed.js"
PACKAGE = "package.json"
HARNESS_TEST = "live-feed-local-harness.test.mjs"
CONTRACT_TEST = "live-feed-comments-contract.test.mjs"
WORKFLOW = ".github/workflows/live-feed-local-supabase.yml"
LOCAL_SCRIPT = "scripts/test-live-feed-local.sh"
DOCS = "docs/live-feed-free-test-plan.md"

# Keep retry state explicit so transient bootstrap failures do not permanently disable the feed.
replace_once(
    CLIENT,
    "    initialized:false,\n    initializing:false,\n    authorizationRefreshing:false,",
    "    initialized:false,\n    initializing:false,\n    initializationRetryTimer:null,\n    authorizationRefreshing:false,",
)

helpers = r'''  function clearInitializationRetry(){
    if(!state.initializationRetryTimer)return;
    clearTimeout(state.initializationRetryTimer);
    state.initializationRetryTimer=null;
  }

  function scheduleInitializationRetry(delay=3000){
    if(state.initialized||state.initializing||state.initializationRetryTimer||!currentAccess()?.active||navigator.onLine===false)return;
    state.initializationRetryTimer=setTimeout(()=>{
      state.initializationRetryTimer=null;
      if(!state.initialized&&!state.initializing&&currentAccess()?.active)initialize();
    },delay);
  }

'''
replace_once(
    CLIENT,
    "  function resetForIdentity(nextIdentityKey=''){",
    helpers + "  function resetForIdentity(nextIdentityKey=''){",
)
replace_once(
    CLIENT,
    "  function resetForIdentity(nextIdentityKey=''){\n    saveDraftState();",
    "  function resetForIdentity(nextIdentityKey=''){\n    saveDraftState();\n    clearInitializationRetry();",
)
replace_once(
    CLIENT,
    "    state.identityKey=nextIdentityKey;state.initialized=false;state.initializing=false;state.authorizationRefreshing=false;",
    "    state.identityKey=nextIdentityKey;state.initialized=false;state.initializing=false;state.initializationRetryTimer=null;state.authorizationRefreshing=false;",
)
replace_once(
    CLIENT,
    "    if(state.initialized||state.initializing)return;\n    state.identityKey=identity.key;state.initializing=true;const generation=state.generation;findMounts();syncComposers();",
    "    if(state.initialized||state.initializing)return;\n    clearInitializationRetry();\n    state.identityKey=identity.key;state.initializing=true;const generation=state.generation;findMounts();syncComposers();",
)
replace_once(
    CLIENT,
    "      state.authorizationReady=true;state.initialized=true;\n    }catch(error){if(generation===state.generation){console.error('Live Feed initialization failed',error);setComposerStatus(error?.message||'Unable to initialize Live Feed.','error');}}",
    "      state.authorizationReady=true;state.initialized=true;clearInitializationRetry();\n    }catch(error){\n      if(generation===state.generation){\n        const message=String(error?.message||'Unable to initialize Live Feed.');\n        console.error('Live Feed initialization failed',error);\n        setComposerStatus(message,'error');\n        if(navigator.onLine!==false&&!/authentication_required|auth_email_mismatch|organization_membership_required|active_organization_profile_required|field_coach_access_required|live_feed_role_not_supported|team_scope_forbidden/.test(message))scheduleInitializationRetry();\n      }\n    }",
)
replace_once(
    CLIENT,
    "  window.addEventListener('mccoy-live-sales-changed',()=>{if(state.selectedScope==='company')loadFeed({quiet:true});});",
    "  window.addEventListener('mccoy-live-sales-changed',()=>{\n    if(state.initialized&&state.authorizationReady&&!state.initializing&&!state.authorizationRefreshing&&state.selectedScope==='company')loadFeed({quiet:true});\n  });",
)
replace_once(
    CLIENT,
    "  window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.initialized)refreshAuthorization();});\n  window.addEventListener('focus',()=>{if(state.initialized)refreshAuthorization();});",
    "  window.addEventListener('visibilitychange',()=>{\n    if(document.visibilityState!=='visible')return;\n    if(state.initialized)refreshAuthorization();else initialize();\n  });\n  window.addEventListener('focus',()=>{if(state.initialized)refreshAuthorization();else initialize();});",
)
replace_once(
    CLIENT,
    "  window.addEventListener('online',()=>{setComposerStatus('Back online. Press RETRY to submit any preserved draft.','ok');syncComposers();});",
    "  window.addEventListener('online',()=>{\n    setComposerStatus('Back online. Press RETRY to submit any preserved draft.','ok');syncComposers();\n    if(state.initialized)refreshAuthorization();else initialize();\n  });",
)
replace_once(
    CLIENT,
    "  window.addEventListener('beforeunload',()=>{if(state.channel&&resolveClient())resolveClient().removeChannel(state.channel);if(authTransitionSubscription)authTransitionSubscription.unsubscribe();});",
    "  window.addEventListener('beforeunload',()=>{clearInitializationRetry();if(state.channel&&resolveClient())resolveClient().removeChannel(state.channel);if(authTransitionSubscription)authTransitionSubscription.unsubscribe();});",
)
replace_once(
    CLIENT,
    "  const poll=setInterval(()=>{findMounts();if(resolveClient())installAuthTransitionGuard();if(currentAccess()?.active&&resolveClient()){clearInterval(poll);initialize();}},300);",
    "  const poll=setInterval(()=>{\n    findMounts();\n    if(resolveClient())installAuthTransitionGuard();\n    if(currentAccess()?.active&&resolveClient()){\n      if(!state.initialized&&!state.initializing&&!state.initializationRetryTimer)initialize();\n      if(state.initialized)clearInterval(poll);\n    }\n  },300);",
)

# Eliminate the arbitrary cleanup-root override; the script may delete only its fixed repository .tmp subtree.
replace_once(
    LOCAL_SCRIPT,
    'WORK_ROOT="${MCCOY_LIVE_FEED_LOCAL_DIR:-${ROOT_DIR}/.tmp/live-feed-local}"',
    'WORK_ROOT="${ROOT_DIR}/.tmp/live-feed-local"',
)

# The documented contract command and CI preflight must execute both the feature contract and harness contract.
replace_once(
    PACKAGE,
    '"test:live-feed:local:contract": "node --test live-feed-local-harness.test.mjs"',
    '"test:live-feed:local:contract": "node --test live-feed-comments-contract.test.mjs live-feed-local-harness.test.mjs"',
)
replace_once(
    WORKFLOW,
    "      - name: Verify the free-test harness contract\n        run: node --test --test-reporter=spec live-feed-local-harness.test.mjs",
    "      - name: Verify the Live Feed feature and free-test harness contracts\n        run: npm run test:live-feed:local:contract -- --test-reporter=spec",
)
replace_once(
    HARNESS_TEST,
    "  assert.match(script,/unsafe local port binding detected/)\n})",
    "  assert.match(script,/unsafe local port binding detected/)\n  assert.doesNotMatch(script,/MCCOY_LIVE_FEED_LOCAL_DIR/)\n})",
)
replace_once(
    HARNESS_TEST,
    "  assert.match(workflow,/bash scripts\\/test-live-feed-local\\.sh/)",
    "  assert.match(workflow,/npm run test:live-feed:local:contract/)\n  assert.match(workflow,/bash scripts\\/test-live-feed-local\\.sh/)",
)
replace_once(
    HARNESS_TEST,
    "  assert.equal(packageJson.scripts['test:live-feed:local:contract'],'node --test live-feed-local-harness.test.mjs')",
    "  assert.equal(packageJson.scripts['test:live-feed:local:contract'],'node --test live-feed-comments-contract.test.mjs live-feed-local-harness.test.mjs')",
)

# Lock the runtime fixes into the feature contract so later refactors cannot reintroduce the race or dead session.
insert_after = "  assert.match(client,/state\\.identityKey&&!state\\.identityKey\\.startsWith\\(nextPrefix\\)/)\n"
contract_path = Path(CONTRACT_TEST)
contract_source = contract_path.read_text(encoding="utf-8")
if contract_source.count(insert_after) != 1:
    raise SystemExit(f"{CONTRACT_TEST}: expected one account-transition assertion anchor")
contract_additions = (
    "  assert.match(client,/function scheduleInitializationRetry/)\n"
    "  assert.match(client,/state\\.initializationRetryTimer=setTimeout/)\n"
    "  assert.match(client,/state\\.initialized&&state\\.authorizationReady&&!state\\.initializing&&!state\\.authorizationRefreshing/)\n"
    "  assert.match(client,/window\\.addEventListener\\('online',[\\s\\S]*if\\(state\\.initialized\\)refreshAuthorization\\(\\);else initialize\\(\\)/)\n"
)
contract_path.write_text(contract_source.replace(insert_after, insert_after + contract_additions, 1), encoding="utf-8")

replace_once(
    DOCS,
    "The same command runs once per pull-request update in `.github/workflows/live-feed-local-supabase.yml`, checking out the exact pull-request head.",
    "The same command runs both the Company/Team feature contract and the free-test harness contract once per pull-request update in `.github/workflows/live-feed-local-supabase.yml`, checking out the exact pull-request head.",
)

print("Applied Live Feed initialization retry, sale-reload race, complete contract, and fixed cleanup-root protections.")
