import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

function loadPortals() {
  const window = {}
  vm.runInNewContext(fs.readFileSync(new URL('./app-provider-portals.js', import.meta.url), 'utf8'), { window })
  return window.MCCOY_PROVIDER_PORTALS
}

test('AT&T and DIRECTV use separate Sara Plus account contexts', () => {
  const portals = loadPortals()
  const login = 'https://www.saraplus.com/e/ServicePages/Login.aspx?ReturnUrl=%2fe%2fDealerPages%2fSubmitOrders.aspx'
  assert.equal(portals['AT&T'].url, login)
  assert.equal(portals.DIRECTV.url, login)
  assert.equal(portals['AT&T'].accountContext, 'AT&T')
  assert.equal(portals.DIRECTV.accountContext, 'DIRECTV')
  assert.equal(portals['AT&T'].sessionGroup, 'sara_plus')
  assert.equal(portals.DIRECTV.sessionGroup, 'sara_plus')
  assert.notEqual(portals['AT&T'].label, portals.DIRECTV.label)
  assert.notEqual(portals['AT&T'].reportLabel, portals.DIRECTV.reportLabel)
  assert.doesNotMatch(portals['AT&T'].url, /\/\(S\(/i)
  assert.doesNotMatch(portals.DIRECTV.url, /\/\(S\(/i)
})

test('provider portal configuration contains no credentials', () => {
  const serialized = JSON.stringify(loadPortals()).toLowerCase()
  assert.doesNotMatch(serialized, /password|username|access_token|secret/)
})

test('provider sale routing uses same-tab navigation after capture persistence', () => {
  const source = fs.readFileSync(new URL('./app-provider-sale-router.js', import.meta.url), 'utf8')
  const continueFlow = source.slice(source.indexOf("providerRouterContinue').addEventListener"))
  assert.match(source, /window\.location\.assign\(destination\.url\)/)
  assert.doesNotMatch(source, /window\.open\(|popup=yes/)
  assert.match(source, /Use browser Back to return to McCoy/)
  assert.ok(continueFlow.indexOf('await waitForCaptureReady(draft)') < continueFlow.indexOf('navigateSellerAccount(provider,destination)'))
  assert.match(source, /markCaptureReturned\(true\)/)
})
