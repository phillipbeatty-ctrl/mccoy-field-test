import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {vercelConfig} from './scripts/vercel-config.mjs'

const vercel=vercelConfig({VERCEL_ENV:'production'})
const router=fs.readFileSync(new URL('./app-provider-sale-router.js',import.meta.url),'utf8')

function header(name){
  const catchAll=vercel.headers.find(rule=>rule.source==='/(.*)')
  return catchAll?.headers?.find(item=>item.key.toLowerCase()===name.toLowerCase())?.value||null
}

test('McCoy retains a reference to trusted cross-origin provider popups',()=>{
  assert.equal(header('Cross-Origin-Opener-Policy'),'same-origin-allow-popups')
  assert.match(router,/window\.open\('about:blank',target\)/)
  assert.match(router,/providerWindow\.closed/)
  assert.match(router,/markCaptureReturned\(true\)/)
})

test('provider popup relaxation does not weaken resource or frame isolation',()=>{
  assert.equal(header('Cross-Origin-Resource-Policy'),'same-origin')
  assert.equal(header('X-Frame-Options'),'DENY')
  assert.match(header('Content-Security-Policy'),/frame-ancestors 'none'/)
})
