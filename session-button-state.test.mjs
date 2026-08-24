import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8')
const sessionInit = fs.readFileSync(new URL('./app-session-init.js', import.meta.url), 'utf8')
const resume = fs.readFileSync(new URL('./app-distance-to-lead.js', import.meta.url), 'utf8')
const autoStop = fs.readFileSync(new URL('./app-auto-stop.js', import.meta.url), 'utf8')

test('idle and active session button labels are deterministic', () => {
  assert.match(html, /id="startKnockingBtn"[^>]*>START KNOCKING<\/button>/)
  assert.match(html, /id="stopKnockingBtn"[^>]*>STOP SESSION<\/button>/)
  assert.match(sessionInit, /stopBtn\.disabled=false;stopBtn\.textContent='STOP SESSION'/)
  assert.match(resume, /stopBtn\.disabled=false;stopBtn\.textContent='STOP SESSION'/)
})

test('STOPPING is restricted to the awaited server stop and always resets', () => {
  assert.equal((autoStop.match(/textContent='STOPPING…'/g) || []).length, 1)
  assert.match(autoStop, /stopBtn\.disabled=true;stopBtn\.textContent='STOPPING…'/)
  assert.match(autoStop, /if\(stop\)\{stop\.disabled=false;stop\.textContent='STOP SESSION';\}/)
  assert.match(autoStop, /if\(stopBtn\)\{stopBtn\.disabled=false;stopBtn\.textContent='STOP SESSION';\}/)
})
