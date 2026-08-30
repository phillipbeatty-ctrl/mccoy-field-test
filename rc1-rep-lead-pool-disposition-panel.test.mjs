import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const layout = read('./app-lead-pool-layout.js')
const pool = read('./app-lead-pool.js')
const detail = read('./app-lead-detail-panel.js')

test('Rep and Tester roles keep the Lead Pool detail and disposition side panel available', () => {
  assert.match(layout, /const expanded=manager&&managerMode===KNOCK_MODE/)
  assert.doesNotMatch(layout, /const expanded=rep\|\|/)
  assert.match(layout, /body\.blind-tester\.lead-pool-rep-layout #leadMapPanel>\.grid-2>\.card:nth-child\(2\)\{display:flex!important\}/)
  assert.match(layout, /setSidePanelAvailable\(sideCard,!expanded\)/)
  assert.match(layout, /Select a map marker to open its lead details and disposition controls/)
})

test('Rep and Tester roles still cannot use lead-assignment controls', () => {
  assert.match(pool, /const canAssignLeads=\(\)=>isAdmin\(\)\|\|isManager\(\)/)
  assert.match(pool, /mapRepSelect','mapAssignBtn','bulkAssignMapBtn'/)
  assert.match(pool, /el\.hidden=!assigner;el\.disabled=!assigner/)
})

test('Map pin selection still opens the shared lead detail workflow', () => {
  assert.match(detail, /window\.addEventListener\('mccoy-map-lead-selected'/)
  assert.match(detail, /renderDetail\(lead\)/)
  assert.match(detail, /mapLeadActivityType/)
  assert.match(detail, /mapLeadVisitResult/)
  assert.match(detail, /mapLeadStage/)
})

test('the release correction does not add a document-wide observer', () => {
  assert.doesNotMatch(layout, /MutationObserver/)
})
