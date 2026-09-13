import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { SALE_PROVIDERS } from './supabase/functions/_shared/provider-sale-capture-core.mjs'

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

test('provider sale routing keeps McCoy open and returns when the provider tab closes', () => {
  const source = fs.readFileSync(new URL('./app-provider-sale-router.js', import.meta.url), 'utf8')
  const continueFlow = source.slice(source.indexOf("providerRouterContinue').addEventListener"))
  assert.match(source, /window\.open\('about:blank',target\)/)
  assert.match(source, /Return to Field Coach when finished, then choose the green check or red X/)
  assert.match(source, /trackProviderWindow\(reservedWindow\)/)
  assert.match(source, /window\.location\.assign\(destination\.url\)/)
  assert.ok(continueFlow.indexOf('const reservedWindow=destination.opened?reserveProviderWindow():null') < continueFlow.indexOf('await waitForCaptureReady(draft)'))
  assert.ok(continueFlow.indexOf('await waitForCaptureReady(draft)') < continueFlow.indexOf('navigateSellerAccount(provider,destination,reservedWindow)'))
  assert.match(source, /markCaptureReturned\(true\)/)
})

test('Ziply uses its own account context on the session-free SaraPlus login', () => {
  const portals = loadPortals()
  assert.equal(portals.Ziply.url, 'https://www.saraplus.com/e/ServicePages/Login.aspx')
  assert.equal(portals.Ziply.accountContext, 'Ziply')
  assert.equal(portals.Ziply.sessionGroup, 'sara_plus')
  assert.notEqual(portals.Ziply.label, portals.Fidium.label)
  assert.doesNotMatch(portals.Ziply.url, /\/\(S\(/i)
  assert.equal(portals.Ziply.reportUrl, undefined)
})

test('all provider selectors agree with server sale validation', () => {
  assert.deepEqual(Object.keys(loadPortals()), [...SALE_PROVIDERS])
  for (const file of ['app-provider-sale-router.js', 'app-provider-verification.js', 'app-sales.js', 'app-customer-list-approval-refresh.js', 'app-sale-order-photo-pilot.js']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8')
    const list = source.match(/const (?:providers|PROVIDERS|fallbackProviders)=\[([^\]]+)\]/)
    assert.ok(list, file)
    assert.deepEqual([...vm.runInNewContext(`[${list[1]}]`)], [...SALE_PROVIDERS], file)
  }
  const products = fs.readFileSync(new URL('./app-sales-products.js', import.meta.url), 'utf8')
  const list = products.match(/const ISP_PROVIDERS=new Set\(\[([^\]]+)\]/)
  assert.ok(list)
  assert.deepEqual([...vm.runInNewContext(`[${list[1]}]`)], SALE_PROVIDERS.filter(provider => !['DIRECTV', 'Vivint'].includes(provider)))
})
