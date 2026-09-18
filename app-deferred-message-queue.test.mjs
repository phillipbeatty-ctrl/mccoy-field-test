import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('./app-deferred-message-queue.js', import.meta.url), 'utf8')

// Builds a fresh, isolated mock browser environment and executes the real
// module source against it via vm, so we're testing actual runtime
// behavior -- not just pattern-matching the source text the way the rest
// of this suite does for client files. This module specifically deserves
// it: both real bugs found during development (watermark advancing before
// delivery; a missing dedup guard) were timing/ordering bugs in stateful
// async logic that no text pattern would have caught.
function makeSandbox({ initialVisibility = 'visible' } = {}) {
  const store = {}
  const visibilityListeners = []
  const sandbox = {
    document: {
      visibilityState: initialVisibility,
      addEventListener: (event, handler) => { if (event === 'visibilitychange') visibilityListeners.push(handler) },
    },
    localStorage: {
      getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      setItem: (key, value) => { store[key] = String(value) },
    },
    console,
    setTimeout,
    Date,
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  return {
    queue: sandbox.window.MCCOY_DEFERRED_QUEUE,
    setVisibility(state) { sandbox.document.visibilityState = state; if (state === 'visible') for (const fn of visibilityListeners) fn() },
    getWatermark: name => store['mccoy_deferred_watermark:' + name],
  }
}

test('a message enqueued while hidden does not deliver until visibility returns', async () => {
  const { queue, setVisibility } = makeSandbox({ initialVisibility: 'hidden' })
  const delivered = []
  queue.registerSource('test_source', {
    getTimestamp: item => item.at,
    deliver: async item => { delivered.push(item) },
    checkMissed: async () => [],
  })
  queue.enqueue('test_source', { id: 1, at: '2026-01-01T00:00:00Z' })
  await new Promise(r => setTimeout(r, 10))
  assert.deepEqual(delivered, [], 'nothing should deliver while hidden')

  setVisibility('visible')
  await new Promise(r => setTimeout(r, 10))
  assert.equal(delivered.length, 1, 'the queued item should deliver once visible')
  assert.equal(delivered[0].id, 1)
})

test('the watermark only advances on actual delivery, not on enqueue while hidden -- regression test for the bug found during development', async () => {
  const { queue, setVisibility, getWatermark } = makeSandbox({ initialVisibility: 'hidden' })
  queue.registerSource('watermark_source', {
    getTimestamp: item => item.at,
    deliver: async () => {},
    checkMissed: async () => [],
  })
  queue.enqueue('watermark_source', { id: 1, at: '2026-01-01T00:00:00Z' })
  await new Promise(r => setTimeout(r, 10))
  assert.equal(getWatermark('watermark_source'), undefined, 'watermark must not advance for an item that was only queued, never shown')

  setVisibility('visible')
  await new Promise(r => setTimeout(r, 10))
  assert.equal(getWatermark('watermark_source'), '2026-01-01T00:00:00Z', 'watermark should advance only once the item is actually delivered')
})

test('registering a source runs a catch-up check and delivers what it finds', async () => {
  const { queue } = makeSandbox({ initialVisibility: 'visible' })
  const delivered = []
  queue.registerSource('catchup_source', {
    getTimestamp: item => item.at,
    deliver: async item => { delivered.push(item) },
    checkMissed: async since => {
      assert.equal(since, null, 'first-ever registration on a fresh device should see no watermark yet')
      return [{ id: 'missed-1', at: '2026-01-01T00:00:00Z' }]
    },
  })
  await new Promise(r => setTimeout(r, 10))
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].id, 'missed-1')
})

test('a stored watermark is passed to checkMissed on a later registration', async () => {
  const { queue } = makeSandbox({ initialVisibility: 'visible' })
  queue.registerSource('watermark_passthrough', {
    getTimestamp: item => item.at,
    deliver: async () => {},
    checkMissed: async () => [{ id: 1, at: '2026-03-01T00:00:00Z' }],
  })
  await new Promise(r => setTimeout(r, 10))

  let seenSince = 'not-called'
  queue.registerSource('watermark_passthrough_2', {
    getTimestamp: item => item.at,
    deliver: async () => {},
    checkMissed: async since => { seenSince = since; return [] },
  })
  await new Promise(r => setTimeout(r, 10))
  assert.equal(seenSince, null, "a different source name should not see another source's watermark")
})

test('throttleMs spaces out deliveries when draining a backlog', async () => {
  const { queue, setVisibility } = makeSandbox({ initialVisibility: 'hidden' })
  const deliveredAt = []
  queue.registerSource('throttled_source', {
    getTimestamp: item => item.at,
    deliver: async item => { deliveredAt.push(Date.now()) },
    checkMissed: async () => [],
    throttleMs: 40,
  })
  queue.enqueue('throttled_source', { id: 1, at: '2026-01-01T00:00:00Z' })
  queue.enqueue('throttled_source', { id: 2, at: '2026-01-01T00:00:01Z' })
  queue.enqueue('throttled_source', { id: 3, at: '2026-01-01T00:00:02Z' })

  setVisibility('visible')
  await new Promise(r => setTimeout(r, 200))
  assert.equal(deliveredAt.length, 3, 'all three queued items should eventually deliver')
  assert.ok(deliveredAt[1] - deliveredAt[0] >= 35, 'second delivery should be throttled after the first')
  assert.ok(deliveredAt[2] - deliveredAt[1] >= 35, 'third delivery should be throttled after the second')
})

test('draining stops immediately if visibility is lost mid-backlog, without dropping remaining items', async () => {
  const { queue, setVisibility } = makeSandbox({ initialVisibility: 'hidden' })
  const delivered = []
  queue.registerSource('interrupt_source', {
    getTimestamp: item => item.at,
    deliver: async item => { delivered.push(item.id); if (item.id === 1) setVisibility('hidden') },
    checkMissed: async () => [],
    throttleMs: 5,
  })
  queue.enqueue('interrupt_source', { id: 1, at: '2026-01-01T00:00:00Z' })
  queue.enqueue('interrupt_source', { id: 2, at: '2026-01-01T00:00:01Z' })

  setVisibility('visible')
  await new Promise(r => setTimeout(r, 50))
  assert.deepEqual(delivered, [1], 'only the first item should deliver before visibility was lost again')

  setVisibility('visible')
  await new Promise(r => setTimeout(r, 50))
  assert.deepEqual(delivered, [1, 2], 'the remaining item should still be there and deliver once visible again')
})
