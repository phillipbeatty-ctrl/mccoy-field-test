import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const controller=readFileSync(new URL('./app-provider-return-focus-v2.js',import.meta.url),'utf8')
const loader=readFileSync(new URL('./app-provider-return-focus-v3-loader.js',import.meta.url),'utf8')
const index=readFileSync(new URL('./index.html',import.meta.url),'utf8')

test('automatic provider return requires a real exit or a closed child',()=>{
  assert.match(controller,/leftAppObserved/)
  assert.match(controller,/if\(!childClosed&&!state\.leftAppObserved\)return/)
  assert.match(controller,/providerWindow\?\.closed/)
  assert.match(controller,/pagehide/)
  assert.match(controller,/visibilitychange/)
  assert.match(controller,/action:'mark_returned'/)
  assert.doesNotMatch(controller,/MutationObserver/)
})

test('v3 bootstrap disables the superseded controller before page layout loads it',()=>{
  assert.match(loader,/window\.MCCOY_PROVIDER_RETURN_FOCUS=true/)
  assert.match(loader,/app-provider-return-focus-v2\.js\?v=2026082802/)
  assert.match(index,/app-provider-return-focus-v3-loader\.js\?v=2026082803/)
  assert.ok(index.indexOf('app-provider-return-focus-v3-loader.js')<index.indexOf('app-page-layout.js'))
})
