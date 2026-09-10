import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('./app-lead-map-deselect.js', import.meta.url), 'utf8');
const mapSource = readFileSync(new URL('./app-lead-map.js', import.meta.url), 'utf8');
const helperSource = mapSource.slice(mapSource.indexOf('  async function fetchAuthoritativeMovePinState('), mapSource.indexOf('  async function startMovePin('));
const handlerSource = mapSource.slice(mapSource.indexOf('  async function confirmMovePin('), mapSource.indexOf('  function selectCorrectionLead('));
const confirmSource = `${helperSource}\n${handlerSource}`;
const controlsSource = readFileSync(new URL('./app-lead-map-window-controls.js', import.meta.url), 'utf8');
const watchStatusSource = controlsSource.split('\n').find(line => line.includes('function watchMoveStatus()'));
const generic = 'Unable to save the proposed location. The original pin is unchanged.';
const detail = 'permission denied for table lead_pin_move_audit';
const moveBody = { action: 'move_lead_pin', lead_id: 'test-lead', client_request_id: 'test-request' };

function httpFailure(payload = { error: 'lead_admin_failed', detail }, status = 500, headers = {}) {
  const context = new Response(typeof payload === 'string' ? payload : JSON.stringify(payload), { status, headers });
  return { data: null, error: { message: 'Edge Function returned a non-2xx status code', context } };
}

// Execute the shipped IIFE and the real confirmMovePin handler with a controlled
// SDK response. No real accounts, leads, GPS, or network calls are used here.
function harness({ role = 'admin', result = httpFailure(), invoke, missingMessage = false, missingClient = false, freshFunctionsGetter = false } = {}) {
  const elements = new Map();
  const observers = new Set();
  const pending = new Set();
  const intervals = new Map();
  const timeouts = [];
  const events = new Map();
  const calls = [];
  const authCallbacks = [];
  const status = { textContent: '' };
  let timerId = 0;
  let ended = [];
  let reloads = 0;
  const message = { value: '', get textContent() { return this.value; }, set textContent(text) {
    this.value = text;
    for (const observer of observers) if (observer.target === this) pending.add(observer);
  } };
  if (!missingMessage) elements.set('leadCorrectionMsg', message);
  const window = {
    MCCOY_ACCESS: { access: { role, active: true }, user: { id: 'test-user' } },
    addEventListener(name, callback) { if (!events.has(name)) events.set(name, []); events.get(name).push(callback); },
    async loadMcCoyLeads() { reloads++; }
  };
  const sb = {
    functions: { async invoke(name, options) { calls.push({ name, options, receiver: this }); if(name==='lead-pin-snapshot')return {data:{ok:true,lead:{id:'test-lead',latitude:10,longitude:20,pin_location_updated_at:'2026-09-04T00:54:25.198452+00:00'}},error:null}; return invoke ? invoke(name, options) : result; } },
    auth: { onAuthStateChange(callback) { authCallbacks.push(callback); return { data: { subscription: { unsubscribe() {} } } }; } }
  };
  if (freshFunctionsGetter) {
    const client = sb.functions;
    Object.defineProperty(sb, 'functions', { get: () => ({ ...client }) });
  }
  const context = vm.createContext({
    window, ...(missingClient ? {} : { sb }), console,
    document: { getElementById: id => elements.get(id) || null, addEventListener() {} },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target) { this.target = target; observers.add(this); }
      disconnect() { observers.delete(this); }
    },
    setInterval(callback) { const id = ++timerId; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback, delay) { timeouts.push({ callback, delay }); return ++timerId; },
    Date, crypto: { randomUUID }, navigator: { platform: 'test' },
    correctionLead: { dbId: 'test-lead', lat: 10, lng: 20, updatedAt: null },
    movePinOriginal: {lat:10,lng:20,latitude:10,longitude:20,updatedAt:'2026-09-04T00:54:25.198452+00:00'},
    movePinProposed: { lat: 10.001, lng: 20.001 }, movePinBusy: false, movePinRequest:0,
    markerByLead: new Map(), selectedIds: new Set(), leadPinIcon() {}, metersBetween() { return 100; },
    syncMovePinButtons() {}, freshGps: async () => ({ lat: 10, lng: 20, accuracy: 1, capturedAt: Date.now() }),
    correctionMsg(text) { message.textContent = text; },
    endMovePin(text) { ended.push(text); message.textContent = text; },
    byId: id => elements.get(id) || null, statusObserver: null,
    showMapStatus(text) { status.textContent = text; }
  });
  vm.runInContext(`${watchStatusSource}\nwatchMoveStatus();`, context);
  vm.runInContext(source, context);
  vm.runInContext(confirmSource, context);
  const tick = () => { for (const callback of [...intervals.values()]) callback(); };
  tick();
  function flush() {
    for (let turns = 0; pending.size; turns++) {
      assert.ok(turns < 10, 'diagnostic observer must settle without looping');
      const callbacks = [...pending]; pending.clear();
      for (const observer of callbacks) observer.callback();
    }
  }
  return {
    window, sb, context, message, status, calls, elements, intervals, timeouts, tick, flush,
    invoke: (name = 'lead-admin', body = moveBody) => name === 'lead-admin' && window.MCCOY_INVOKE_MOVE_PIN ? window.MCCOY_INVOKE_MOVE_PIN(body) : sb.functions.invoke(name, { body }),
    async confirm() { await context.confirmMovePin(); flush(); return message.textContent; },
    render(text = generic) { message.textContent = text; flush(); return message.textContent; },
    authChange(role) { window.MCCOY_ACCESS.access.role = role; for (const callback of authCallbacks) callback('SIGNED_OUT', null); flush(); },
    dispatch(name) { for (const callback of events.get(name) || []) callback(); },
    get ended() { return ended; }, get reloads() { return reloads; }
  };
}

test('Admin sees the actual HTTP 500 backend detail through the real MOVE PIN failure handler', async () => {
  const h = harness();
  assert.match(await h.confirm(), new RegExp(`Admin diagnostic:.*${detail}`));
  assert.match(h.message.textContent, /HTTP 500/);
  assert.equal(h.status.textContent, h.message.textContent, 'the visible in-map status receives the Admin diagnostic');
  assert.match(h.window.MCCOY_LAST_MOVE_PIN_ERROR.reason, /lead_admin_failed/);
  assert.deepEqual([h.context.correctionLead.lat, h.context.correctionLead.lng], [10, 20]);
});

for (const role of ['rep', 'manager', 'trainer', 'tester', '', undefined]) {
  test(`${String(role) || 'unknown role'} keeps the generic message and does not capture Admin diagnostics`, async () => {
    const result = httpFailure();
    const h = harness({ role: role === undefined ? null : role, result });
    assert.equal(await h.confirm(), generic);
    assert.equal(h.status.textContent, generic);
    assert.equal(result.data, null);
    assert.ok(!h.window.MCCOY_LAST_MOVE_PIN_ERROR);
    assert.doesNotMatch(h.message.textContent, /permission denied|Admin diagnostic|HTTP 500/);
  });
}

test('diagnostics preserve the SDK response and original HTTP body for every role', async () => {
  for (const role of ['admin', 'rep']) {
    const result = httpFailure();
    const h = harness({ role, result });
    const returned = await h.invoke();
    assert.equal(returned, result);
    assert.equal(returned.data, null);
    assert.equal(returned.error.context.bodyUsed, false);
    assert.equal(h.calls[0].receiver, h.sb.functions);
    assert.equal(h.calls[0].options.body, moveBody);
    assert.deepEqual(await returned.error.context.json(), { error: 'lead_admin_failed', detail });
  }
});

test('generic wrappers include trimmed detail, while specific error codes retain their meaning', async () => {
  for (const error of ['lead_admin_failed', 'move_lead_pin_failed', 'location_save_failed']) {
    const h = harness({ result: httpFailure({ error, detail: `  ${detail}  ` }) });
    await h.invoke();
    assert.equal(h.window.MCCOY_LAST_MOVE_PIN_ERROR.reason, `${error}: ${detail}`);
  }
  const h = harness({ result: httpFailure({ error: 'unauthorized_lead', detail: 'internal detail' }, 403) });
  await h.invoke();
  assert.equal(h.window.MCCOY_LAST_MOVE_PIN_ERROR.reason, 'unauthorized_lead');
});

test('missing and blank detail fall back to the wrapper, message, or SDK error', async () => {
  const cases = [
    [{ error: 'lead_admin_failed' }, 'lead_admin_failed'],
    [{ error: 'lead_admin_failed', detail: '  ' }, 'lead_admin_failed'],
    [{ error: '  ', detail: 'actual detail' }, 'actual detail'],
    [{ message: 'gateway rejection' }, 'gateway rejection'],
    [{}, 'Edge Function returned a non-2xx status code']
  ];
  for (const [payload, expected] of cases) {
    const h = harness({ result: httpFailure(payload) });
    await h.invoke();
    assert.equal(h.window.MCCOY_LAST_MOVE_PIN_ERROR.reason, expected);
  }
});

test('detail text cannot select a different save-error branch or reload leads', async () => {
  const h = harness({ result: httpFailure({ error: 'lead_admin_failed', detail: 'stale_lead unauthorized_lead database exception' }) });
  const message = await h.confirm();
  assert.ok(message.startsWith(`${generic} Admin diagnostic:`));
  assert.match(message, /stale_lead unauthorized_lead database exception/);
  assert.equal(h.reloads, 0);
  assert.equal(h.ended.length, 0);
});

test('structured stale-lead retains the proposal for an explicit retry while GPS/assignment messages remain safe', async () => {
  for (const role of ['admin', 'rep']) {
    for (const [error, message] of [
      ['stale_lead', 'The saved pin changed. Its current version is loaded; review the proposed location and tap the green check again.'],
      ['fresh_gps_required', 'A fresh GPS fix is required before this field correction can be confirmed.'],
      ['unauthorized_lead', 'Your assignment changed or you no longer control this lead.']
    ]) {
      const h = harness({ role, result: { data: { ok: false, error }, error: null } });
      assert.ok((await h.confirm()).startsWith(message));
      assert.equal(h.reloads, 0);
    }
  }
});

test('plain text, malformed JSON, and a missing HTTP context never mask the original failure', async () => {
  for (const result of [httpFailure('<h1>upstream failed</h1>'), httpFailure('{broken'), { data: null, error: { message: 'Failed to fetch' } }]) {
    const h = harness({ result });
    assert.equal(await h.invoke(), result);
    assert.ok(h.render().startsWith(`${generic} Admin diagnostic:`));
    assert.ok(h.window.MCCOY_LAST_MOVE_PIN_ERROR.reason);
  }
});

test('HTTP status and Supabase code render as text; markup in detail is not interpreted', async () => {
  const h = harness({ result: httpFailure({ error: 'lead_admin_failed', detail: '<img src=x onerror=alert(1)>' }, 500, { 'sb-error-code': 'test-code' }) });
  await h.invoke();
  assert.equal(h.render(), `${generic} Admin diagnostic: lead_admin_failed: <img src=x onerror=alert(1)> · HTTP 500 · Supabase test-code.`);
  assert.equal(Object.hasOwn(h.message, 'innerHTML'), false);
});

test('success and a new move clear a previous error', async () => {
  let result = httpFailure();
  const h = harness({ invoke: () => result });
  await h.invoke();
  assert.ok(h.window.MCCOY_LAST_MOVE_PIN_ERROR);
  result = { data: { ok: true }, error: null };
  assert.equal(await h.invoke(), result);
  assert.ok(!h.window.MCCOY_LAST_MOVE_PIN_ERROR);
  assert.equal(h.render(), generic);
});

test('unrelated functions and actions pass through without reading the error body', async () => {
  for (const [name, action] of [['lead-geocode', 'move_lead_pin'], ['lead-admin', 'assign_leads'], ['lead-admin', undefined]]) {
    const result = { data: null, error: { get context() { throw Error('must not read unrelated response'); } } };
    const h = harness({ result });
    assert.equal(await h.invoke(name, { action }), result);
    assert.ok(!h.window.MCCOY_LAST_MOVE_PIN_ERROR);
  }
});

test('an account change while a request is pending prevents Admin detail capture', async () => {
  let complete;
  const h = harness({ invoke: () => new Promise(resolve => { complete = resolve; }) });
  const pending = h.invoke();
  h.authChange('rep');
  complete(httpFailure());
  await pending;
  assert.ok(!h.window.MCCOY_LAST_MOVE_PIN_ERROR);
  assert.equal(h.render(), generic);
});

test('an account change clears already rendered Admin detail and retained metadata', async () => {
  const h = harness();
  await h.invoke();
  assert.match(h.render(), /Admin diagnostic/);
  h.authChange('rep');
  assert.equal(h.message.textContent, generic);
  assert.equal(h.status.textContent, generic);
  assert.ok(!h.window.MCCOY_LAST_MOVE_PIN_ERROR);
});

test('a stale response cannot replace diagnostics for a newer move', async () => {
  const completions = [];
  const h = harness({ invoke: () => new Promise(resolve => completions.push(resolve)) });
  const first = h.invoke();
  const second = h.invoke('lead-admin', { ...moveBody, lead_id: 'second-lead' });
  completions[1](httpFailure({ error: 'lead_admin_failed', detail: 'latest failure' }));
  await second;
  completions[0](httpFailure({ error: 'lead_admin_failed', detail: 'outdated failure' }));
  await first;
  assert.equal(h.window.MCCOY_LAST_MOVE_PIN_ERROR.lead_id, 'second-lead');
  assert.match(h.window.MCCOY_LAST_MOVE_PIN_ERROR.reason, /latest failure/);
});

test('a late client or message element can install diagnostics on the MOVE PIN lifecycle event', async () => {
  const h = harness({ missingMessage: true, missingClient: true });
  for (const timer of h.timeouts) if (timer.delay === 10000) timer.callback();
  h.context.sb = h.sb;
  h.elements.set('leadCorrectionMsg', h.message);
  h.dispatch('mccoy-map-move-pin-started');
  await h.invoke();
  assert.match(h.render(), /permission denied/);
  const wrapped = h.window.MCCOY_INVOKE_MOVE_PIN;
  h.dispatch('mccoy-real-leads-loaded');
  assert.equal(h.window.MCCOY_INVOKE_MOVE_PIN, wrapped);
});

test('the account is rechecked after an asynchronous HTTP body read', async () => {
  let finishParsing;
  const result = { data: null, error: { message: 'HTTP error', context: {
    status: 500, clone() { return { json: () => new Promise(resolve => { finishParsing = resolve; }) }; }
  } } };
  const h = harness({ result });
  const request = h.invoke();
  for (let turn = 0; turn < 10 && !finishParsing; turn++) await Promise.resolve();
  assert.equal(typeof finishParsing, 'function');
  h.authChange('rep');
  finishParsing({ error: 'lead_admin_failed', detail });
  assert.equal(await request, result);
  assert.ok(!h.window.MCCOY_LAST_MOVE_PIN_ERROR);
  assert.equal(h.render(), generic);
});

test('an Admin role without an authenticated user does not capture diagnostics', async () => {
  const h = harness();
  h.window.MCCOY_ACCESS.user = null;
  assert.equal(await h.confirm(), generic);
  assert.ok(!h.window.MCCOY_LAST_MOVE_PIN_ERROR);
});

test('the real confirm handler captures detail with the Supabase fresh-functions getter', async () => {
  for (const role of ['admin', 'rep']) {
    const h = harness({ role, freshFunctionsGetter: true });
    assert.notEqual(h.sb.functions, h.sb.functions, 'match the real SDK getter contract');
    const message = await h.confirm();
    if (role === 'admin') assert.match(message, /Admin diagnostic: lead_admin_failed: permission denied/);
    else assert.equal(message, generic);
    assert.equal(h.calls.length, 1);
  }
});

test('the opt-in live probe cannot submit a real lead identifier or GPS', () => {
  const probe = readFileSync(new URL('./move-pin-diagnostics-probe.js', import.meta.url), 'utf8');
  assert.match(source, /get\('move_pin_diagnostics'\)===\x271\x27/);
  assert.match(probe, /lead_id:'__invalid_uuid_move_pin_probe__'/);
  assert.match(probe, /proposed_latitude:0/);
  assert.match(probe, /proposed_longitude:0/);
  for (const field of ['original_latitude', 'original_longitude', 'actor_latitude', 'actor_longitude', 'actor_accuracy_meters', 'gps_captured_at']) {
    assert.match(probe, new RegExp(`${field}:null`));
  }
  assert.doesNotMatch(probe, /navigator\.geolocation|state\.realLeads|correctionLead|\.rpc\(|\.from\(/);
  assert.match(probe, /output\.textContent=shown/);
});

for (const role of ['admin','rep']) {
  test(`${role} refreshes a real SDK HTTP 409 stale rejection and keeps the proposal`, async () => {
    const h=harness({role,result:httpFailure({error:'stale_lead',detail:'private database detail'},409)});
    assert.match(await h.confirm(), /tap the green check again/);
    assert.equal(h.reloads,0);
    assert.equal(h.ended.length,0);
    if(role==='admin')assert.match(h.message.textContent,/Admin diagnostic: stale_lead · HTTP 409/);
    else assert.doesNotMatch(h.message.textContent,/private database detail|Admin diagnostic/);
  });
  test(`${role} sees the safe assignment message from an HTTP 403 rejection`, async () => {
    const h=harness({role,result:httpFailure({error:'unauthorized_lead',detail:'private database detail'},403)});
    assert.match(await h.confirm(), /Your assignment changed/);
    assert.equal(h.reloads,0);
    if(role==='admin')assert.match(h.message.textContent,/Admin diagnostic: unauthorized_lead: private database detail · HTTP 403/);
    else assert.doesNotMatch(h.message.textContent,/private database detail/);
  });
}

test('confirmation keeps the original microsecond version even if the live lead object changes after dragging',async()=>{
  const h=harness({result:{data:{ok:true,decision:'accepted',lead:{latitude:10.001,longitude:20.001,updated_at:'2026-09-06T12:00:00.123456+00:00'}},error:null}});
  h.context.correctionLead.lat=11;h.context.correctionLead.lng=21;h.context.correctionLead.updatedAt='2026-09-06T11:00:00Z';
  assert.equal(await h.confirm(),'Location confirmed and saved.');
  const body=h.calls[0].options.body;
  assert.equal(body.expected_updated_at,'2026-09-04T00:54:25.198452+00:00');
  assert.equal(body.original_latitude,10);assert.equal(body.original_longitude,20);
  assert.equal(h.context.correctionLead.lat,10.001);
  assert.equal(h.context.correctionLead.updatedAt,'2026-09-06T12:00:00.123456+00:00');
});

test('a review point keeps null original database coordinates instead of sending zero',async()=>{
  const h=harness();h.context.movePinOriginal.latitude=null;h.context.movePinOriginal.longitude=null;
  await h.confirm();
  assert.equal(h.calls[0].options.body.original_latitude,null);
  assert.equal(h.calls[0].options.body.original_longitude,null);
});

test('leaving the move while GPS is pending cannot submit a late save',async()=>{
  const h=harness();let resolveGps;h.context.freshGps=()=>new Promise(resolve=>{resolveGps=resolve});
  const confirming=h.confirm();h.context.movePinRequest++;resolveGps(null);await confirming;
  assert.equal(h.calls.length,0);
});

test('a second confirmation during a pending request cannot send a duplicate move',async()=>{
  const h=harness();let resolveGps;h.context.freshGps=()=>new Promise(resolve=>{resolveGps=resolve});
  const confirming=h.confirm();await h.confirm();resolveGps(null);await confirming;
  assert.equal(h.calls.length,1);
});

test('non-Admin confirmation still requires GPS before any backend write',async()=>{
  const h=harness({role:'rep'});h.context.freshGps=async()=>null;
  assert.match(await h.confirm(),/A fresh GPS fix is required/);
  assert.equal(h.calls.length,0);
});
