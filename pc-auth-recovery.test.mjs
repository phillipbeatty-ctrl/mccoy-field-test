import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const beforeAuth=readFileSync(new URL('./app-part3.js',import.meta.url),'utf8')
const recovery=readFileSync(new URL('./app-auth-production-redirect.js',import.meta.url),'utf8')
const index=readFileSync(new URL('./index.html',import.meta.url),'utf8')

test('bounded auth lock guard executes before app-auth',()=>{
  assert.ok(index.indexOf('app-part3.js')<index.indexOf('app-auth.js'))
  assert.match(beforeAuth,/MCCOY_AUTH_LOCK_GUARD/)
  assert.match(beforeAuth,/MAX_LOCK_WAIT_MS=4500/)
  assert.match(beforeAuth,/navigator\.locks\.request/)
  assert.match(beforeAuth,/controller\.abort\('mccoy_auth_lock_timeout'\)/)
  assert.match(beforeAuth,/continuing this authentication attempt without the stale browser lock/)
  assert.ok(beforeAuth.indexOf('MCCOY_AUTH_LOCK_GUARD')<beforeAuth.indexOf('V9 thin Admin\/Manager analytics viewer'))
})

test('desktop sign-in has a bounded primary attempt and isolated recovery client',()=>{
  assert.match(recovery,/SIGN_IN_TIMEOUT_MS=12000/)
  assert.match(recovery,/mccoy_primary_signin_timeout/)
  assert.match(recovery,/mccoy_recovery_signin_timeout/)
  assert.match(recovery,/storageKey:AUTH_STORAGE_KEY/)
  assert.match(recovery,/lock:async\(_name,_timeout,fn\)=>fn\(\)/)
  assert.match(recovery,/Chrome did not release the prior McCoy session/)
  assert.match(recovery,/location\.reload\(\)/)
})

test('blank auth startup can reload once and then expose a usable login',()=>{
  assert.match(recovery,/STARTUP_TIMEOUT_MS=10000/)
  assert.match(recovery,/mccoy_auth_startup_reload/)
  assert.match(recovery,/gate\.classList\.remove\('auth-checking','hidden'\)/)
  assert.match(recovery,/this tab now uses the recovery path/)
})

test('auth recovery avoids continuous DOM observation',()=>{
  assert.doesNotMatch(recovery,/new\s+MutationObserver|MutationObserver\s*\(/)
  assert.match(recovery,/\[0,50,150,350,700,1400\]/)
})
