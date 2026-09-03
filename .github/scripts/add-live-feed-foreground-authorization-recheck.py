from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    source = file_path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement target, found {count}")
    file_path.write_text(source.replace(old, new, 1), encoding="utf-8")


CLIENT = "app-live-feed.js"
TEST = "live-feed-comments-contract.test.mjs"
DOCS = "docs/live-feed-comments-preview.md"
FREE_DOCS = "docs/live-feed-free-test-plan.md"

replace_once(
    CLIENT,
    "  const COMMENT_TOAST_DURATION_MS=4000;\n  const mountState=new Map();",
    "  const COMMENT_TOAST_DURATION_MS=4000;\n  const AUTHORIZATION_RECHECK_MS=120000;\n  const AUTHORIZATION_RECHECK_RETRY_MS=15000;\n  const mountState=new Map();",
)
replace_once(
    CLIENT,
    "    initializationRetryTimer:null,\n    authorizationRefreshing:false,",
    "    initializationRetryTimer:null,\n    authorizationRecheckTimer:null,\n    authorizationRefreshing:false,",
)

recheck_helpers = r'''  function clearAuthorizationRecheck(){
    if(!state.authorizationRecheckTimer)return;
    clearTimeout(state.authorizationRecheckTimer);
    state.authorizationRecheckTimer=null;
  }

  function scheduleAuthorizationRecheck(delay=AUTHORIZATION_RECHECK_MS){
    clearAuthorizationRecheck();
    if(!state.initialized||!currentAccess()?.active)return;
    state.authorizationRecheckTimer=setTimeout(()=>{
      state.authorizationRecheckTimer=null;
      if(!state.initialized||!currentAccess()?.active)return;
      if(document.visibilityState!=='visible'||navigator.onLine===false||state.posting||state.initializing||state.authorizationRefreshing){
        scheduleAuthorizationRecheck(AUTHORIZATION_RECHECK_RETRY_MS);
        return;
      }
      refreshAuthorization();
    },delay);
  }

'''
replace_once(
    CLIENT,
    "  function clearInitializationRetry(){",
    recheck_helpers + "  function clearInitializationRetry(){",
)
replace_once(
    CLIENT,
    "    clearInitializationRetry();\n    state.generation+=1;",
    "    clearInitializationRetry();\n    clearAuthorizationRecheck();\n    state.generation+=1;",
)
replace_once(
    CLIENT,
    "state.initializationRetryTimer=null;state.authorizationRefreshing=false;",
    "state.initializationRetryTimer=null;state.authorizationRecheckTimer=null;state.authorizationRefreshing=false;",
)
replace_once(
    CLIENT,
    "  async function refreshAuthorization(){\n    if(!state.initialized||state.initializing||state.authorizationRefreshing)return;",
    "  async function refreshAuthorization(){\n    if(!state.initialized||state.initializing||state.authorizationRefreshing||state.posting){\n      if(state.initialized)scheduleAuthorizationRecheck(AUTHORIZATION_RECHECK_RETRY_MS);\n      return;\n    }\n    clearAuthorizationRecheck();",
)
replace_once(
    CLIENT,
    "      if(activeGeneration===state.generation){state.authorizationRefreshing=false;syncComposers();}\n    }\n  }",
    "      if(activeGeneration===state.generation){\n        state.authorizationRefreshing=false;syncComposers();\n        scheduleAuthorizationRecheck(state.authorizationReady?AUTHORIZATION_RECHECK_MS:AUTHORIZATION_RECHECK_RETRY_MS);\n      }\n    }\n  }",
)
replace_once(
    CLIENT,
    "      state.authorizationReady=true;state.initialized=true;clearInitializationRetry();",
    "      state.authorizationReady=true;state.initialized=true;clearInitializationRetry();scheduleAuthorizationRecheck();",
)
replace_once(
    CLIENT,
    "  window.addEventListener('beforeunload',()=>{clearInitializationRetry();if(state.channel&&resolveClient())resolveClient().removeChannel(state.channel);if(authTransitionSubscription)authTransitionSubscription.unsubscribe();});",
    "  window.addEventListener('beforeunload',()=>{clearInitializationRetry();clearAuthorizationRecheck();if(state.channel&&resolveClient())resolveClient().removeChannel(state.channel);if(authTransitionSubscription)authTransitionSubscription.unsubscribe();});",
)

anchor = "  assert.match(client,/window\\.addEventListener\\('online',[\\s\\S]*if\\(state\\.initialized\\)refreshAuthorization\\(\\);else initialize\\(\\)/)\n"
test_path = Path(TEST)
test_source = test_path.read_text(encoding="utf-8")
if test_source.count(anchor) != 1:
    raise SystemExit(f"{TEST}: expected one continuous-authorization assertion anchor")
additions = (
    "  assert.match(client,/AUTHORIZATION_RECHECK_MS=120000/)\n"
    "  assert.match(client,/function scheduleAuthorizationRecheck/)\n"
    "  assert.match(client,/state\\.authorizationRecheckTimer=setTimeout/)\n"
    "  assert.match(client,/document\\.visibilityState!==\'visible\'[\\s\\S]*state\\.posting[\\s\\S]*scheduleAuthorizationRecheck\\(AUTHORIZATION_RECHECK_RETRY_MS\\)/)\n"
    "  assert.match(client,/state\\.authorizationReady=true;state\\.initialized=true;clearInitializationRetry\\(\\);scheduleAuthorizationRecheck\\(\\)/)\n"
)
test_path.write_text(test_source.replace(anchor, anchor + additions, 1), encoding="utf-8")

replace_once(
    DOCS,
    "During permission revalidation, the client hides the prior feed and draft, disables the composer, restarts Realtime, and performs a new selected-scope snapshot after subscription.",
    "During permission revalidation, the client hides the prior feed and draft, disables the composer, restarts Realtime, and performs a new selected-scope snapshot after subscription. While the app remains continuously foregrounded, a two-minute server authorization timer repeats the same fail-closed check; it defers during an active post and retries after fifteen seconds.",
)
replace_once(
    FREE_DOCS,
    "Also verify launcher, splash, login logo, update behavior, background/foreground permission refresh, deletion propagation, and verified-sale celebration priority.",
    "Also verify launcher, splash, login logo, update behavior, background/foreground permission refresh, deletion propagation, and verified-sale celebration priority. While the app remains continuously foregrounded, verify that the two-minute fail-closed authorization check runs and defers an active post for a fifteen-second retry rather than interrupting it.",
)

print("Added continuous foreground authorization revalidation and locked it into contracts.")