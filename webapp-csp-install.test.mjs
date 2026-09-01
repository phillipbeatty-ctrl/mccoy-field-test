import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'

const read=path=>readFile(new URL(path,import.meta.url),'utf8')
const [iosPage,iosController,downloadPage,installer]=await Promise.all([
  read('./install-ios.html'),
  read('./install-ios.js'),
  read('./download.html'),
  read('./webapp-installer.js')
])

function assertNoInlineScript(source,name){
  const scriptTags=[...source.matchAll(/<script\b([^>]*)>/gi)]
  assert.ok(scriptTags.length>0,`${name} must load a controller`)
  for(const match of scriptTags)assert.match(match[1],/\bsrc=/i,`${name} cannot use inline script under production CSP`)
}

// Explanatory no-purchase language is allowed; interactive purchase controls are not.
function assertNoPurchaseAction(source){
  assert.doesNotMatch(source,/href=["'][^"']*(?:stripe\.com|checkout|subscribe|billing|purchase)[^"']*["']/i)
  assert.doesNotMatch(source,/<(?:a|button)\b[^>]*>\s*(?:subscribe now|buy now|purchase|checkout)\b/i)
}

test('production installation pages are compatible with the deployed script-src CSP',()=>{
  assertNoInlineScript(iosPage,'install-ios.html')
  assertNoInlineScript(downloadPage,'download.html')
  assert.match(iosPage,/src="\/install-ios\.js"/)
  assert.match(downloadPage,/src="\/webapp-installer\.js"/)
})

test('iOS controller detects installed mode, copies the production guide, and refreshes the service worker',()=>{
  assert.match(iosController,/display-mode: standalone/)
  assert.match(iosController,/window\.navigator\.standalone/)
  assert.match(iosController,/\/install-ios\.html/)
  assert.match(iosController,/navigator\.clipboard\.writeText/)
  assert.match(iosController,/serviceWorker\.register\('\/service-worker\.js'/)
})

test('browser controller uses the native install prompt and never fabricates an iOS download',()=>{
  assert.match(installer,/beforeinstallprompt/)
  assert.match(installer,/event\.preventDefault\(\)/)
  assert.match(installer,/promptEvent\.prompt\(\)/)
  assert.match(installer,/appinstalled/)
  assert.doesNotMatch(installer,/\.mobileconfig|ipa|App Store/i)
})

test('installation center links to the CSP-compatible iPhone and iPad guide without a purchase action',()=>{
  assert.match(downloadPage,/href="\/install-ios\.html"/)
  assert.match(iosPage,/Open this page in Safari/i)
  assert.match(iosPage,/Add to Home Screen/i)
  assertNoPurchaseAction(downloadPage)
  assertNoPurchaseAction(iosPage)
})
