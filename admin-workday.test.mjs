import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration=fs.readFileSync(new URL('./supabase/migrations/20260905010000_admin_home_and_workday_timeline.sql',import.meta.url),'utf8')
const edge=fs.readFileSync(new URL('./supabase/functions/admin-workday/index.ts',import.meta.url),'utf8')
const adminUi=fs.readFileSync(new URL('./app-admin-workday.js',import.meta.url),'utf8')
const repUi=fs.readFileSync(new URL('./app-sph-home-admin-only.js',import.meta.url),'utf8')
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8')

test('reps cannot write Home settings',()=>{
  assert.match(migration,/revoke all on function public\.set_sph_home_location[\s\S]+from public, anon, authenticated/)
  assert.doesNotMatch(repUi,/set_sph_home_location|SAVE HOME|street-address/)
  assert.match(repUi,/End-of-shift address/)
})

test('Admin Home writer is organization scoped and audited transactionally',()=>{
  assert.match(migration,/a\.role='admin'/)
  assert.match(migration,/a\.organization_id=p_organization_id/g)
  assert.match(migration,/insert into private\.sph_home_setting_audit/)
  assert.match(migration,/old_home_label,old_home_latitude,old_home_longitude/)
  assert.match(migration,/grant execute[\s\S]+to service_role/)
  assert.doesNotMatch(migration,/grant execute on function public\.admin_set_sph_home_location[^;]+to authenticated;/)
})

test('Home Edge function keeps server-side Google credentials private',()=>{
  assert.match(edge,/Deno\.env\.get\('GOOGLE_MAPS_API_KEY'\)/)
  assert.doesNotMatch(adminUi,/GOOGLE_MAPS_API_KEY/)
})

test('timeline is Admin-only and never exposes coordinates',()=>{
  assert.match(migration,/get_admin_workday_timeline/)
  assert.match(migration,/role='admin'/)
  assert.match(migration,/revoke all on function public\.get_admin_workday_timeline\(date,uuid\) from public, anon/)
  assert.doesNotMatch(migration,/'latitude',|'longitude',/)
  assert.doesNotMatch(adminUi,/\.latitude|\.longitude/)
})

test('timeline provides all five requested color classes and evidence',()=>{
  for(const name of ['working','allowed_break','excessive_idle','tracking_gap','homeward_travel']){
    assert.match(adminUi,new RegExp(`${name}:`))
    assert.match(migration,new RegExp(`'${name}'`))
  }
  assert.match(adminUi,/gps_confidence/)
  assert.match(adminUi,/maximum_distance_outside_area_meters/)
  assert.match(adminUi,/average_accuracy_meters/)
  assert.match(adminUi,/segment\.reason/)
})

test('browser loads Admin controls and removes rep Home input after base module',()=>{
  assert.match(html,/app-admin-workday\.js\?v=2026090601/)
  const presence=html.indexOf('app-sph-presence.js')
  const guard=html.indexOf('app-sph-home-admin-only.js')
  assert.ok(presence>=0&&guard>presence)
})
