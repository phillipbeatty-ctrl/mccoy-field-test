#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const STAGES = new Map([
  ['1', 'Prospecting / Keep Knocking'], ['28', 'Hot Lead'], ['30', 'SMB'],
  ['22', 'Contacted'], ['25', 'Follow-up'], ['3', 'No Sale Made'],
  ['27', 'Existing Customer'], ['19', 'Sale Made'], ['24', 'Migrator'],
])
const PACIFIC = 'America/Los_Angeles'
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim().replace(/^,+|,+$/g, '').trim()
const folded = value => clean(value).normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]+/g, '')
const unitKey = value => clean(value).normalize('NFKD').toUpperCase().replace(/[^A-Z0-9/-]+/g, '')
const normalizedPhone = value => clean(value).replace(/[^0-9]+/g, '')
const valueOrBlank = value => clean(value) === '-' ? '' : clean(value)
const fieldMap = item => new Map((item?.fields || []).filter(Boolean).map(field => [String(field.fieldId), clean(field.value)]))
const apiName = item => {
  const fields = fieldMap(item)
  return clean(item?.name) || clean(`${fields.get('100002') || ''} ${fields.get('100003') || ''}`)
}
const apiUnit = item => {
  const fields = fieldMap(item)
  return clean(item?.addressUnit) || fields.get('100001') || ''
}
const pacificMinute = value => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC, month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).formatToParts(date)
  const part = type => parts.find(entry => entry.type === type)?.value || ''
  return folded(`${part('month')} ${part('day')} ${part('year')} ${part('hour')} ${part('minute')} ${part('dayPeriod')}`)
}
const domMinute = value => folded(value)

function parseAddress(value) {
  const raw = clean(value)
  const match = raw.match(/^(.*?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\s*,?\s*(?:US|USA)?\s*$/i)
  if (!match) return { ok: false, raw }
  return {
    ok: true,
    raw,
    address1: clean(match[1]),
    city: clean(match[2]),
    state: clean(match[3]).toUpperCase(),
    zip: clean(match[4]),
  }
}

function addressUnitKey(address, unit) {
  const parsed = parseAddress(address)
  if (!parsed.ok) return ''
  return [folded(parsed.address1), unitKey(unit), folded(parsed.city), parsed.state, parsed.zip.slice(0, 5)].join('|')
}

function signature({ address, unit, name, stage, minute }) {
  return [addressUnitKey(address, unit), folded(name), folded(stage), folded(minute)].join('|')
}

function pushIndex(index, key, value) {
  if (!key) return
  const rows = index.get(key) || []
  rows.push(value)
  index.set(key, rows)
}

const args = process.argv.slice(2)
const input = args.find(arg => !arg.startsWith('--'))
const outputFlag = args.find(arg => arg.startsWith('--output='))
const batchFlag = args.find(arg => arg.startsWith('--batch-id='))
if (!input) {
  console.error('Usage: node scripts/read-only-spotio-batch-recovery.mjs <capture.json> [--batch-id=<uuid>] [--output=<report.json>]')
  process.exit(2)
}

const source = JSON.parse(await readFile(resolve(input), 'utf8'))
const domRows = Array.isArray(source.dom_leads) ? source.dom_leads : []
const apiById = new Map()
for (const capture of Array.isArray(source.captures) ? source.captures : []) {
  const items = Array.isArray(capture?.data?.items) ? capture.data.items : []
  for (const item of items) if (item?.id) apiById.set(String(item.id), item)
}

const exactIndex = new Map()
for (const item of apiById.values()) {
  const address = item?.pin?.address || ''
  const unit = apiUnit(item)
  const name = apiName(item)
  const stage = STAGES.get(String(item.stageId || '')) || ''
  const minute = pacificMinute(item.lastActivityTime || item.createdAt)
  pushIndex(exactIndex, signature({ address, unit, name, stage, minute }), item)
}

const addressGroups = new Map()
const stableMatches = []
const domOnly = []
const parseFailures = []
let explicitUnits = 0
let names = 0
let phones = 0
for (let index = 0; index < domRows.length; index++) {
  const row = domRows[index] || {}
  const cells = Array.isArray(row.raw_cells) ? row.raw_cells : []
  const name = valueOrBlank(cells[1])
  const stage = valueOrBlank(cells[2])
  const minute = valueOrBlank(cells[3])
  const address = valueOrBlank(cells[4])
  const unit = valueOrBlank(cells[8])
  const phone = valueOrBlank(cells[10])
  const parsed = parseAddress(address)
  if (!parsed.ok) parseFailures.push({ row_index: index, raw_address: address })
  if (unit) explicitUnits++
  if (name) names++
  if (normalizedPhone(phone)) phones++

  const groupKey = addressUnitKey(address, unit)
  const group = addressGroups.get(groupKey) || []
  group.push({ index, name, stage, minute, phone })
  addressGroups.set(groupKey, group)

  const matches = exactIndex.get(signature({ address, unit, name, stage, minute: domMinute(minute) })) || []
  if (matches.length === 1) {
    stableMatches.push({ row_index: index, provider_lead_id: String(matches[0].id), address, unit, name })
  } else {
    domOnly.push({ row_index: index, address, unit, name, match_count: matches.length })
  }
}

let repeatedGroups = 0
let repeatedExtraRows = 0
let multipleNamedOccupantGroups = 0
let namedBlankMixGroups = 0
let allBlankNameGroups = 0
let stageChangeGroups = 0
let phoneConflictGroups = 0
for (const rows of addressGroups.values()) {
  if (rows.length <= 1) continue
  repeatedGroups++
  repeatedExtraRows += rows.length - 1
  const distinctNames = new Set(rows.map(row => folded(row.name)).filter(Boolean))
  const blankNames = rows.filter(row => !folded(row.name)).length
  const distinctStages = new Set(rows.map(row => folded(row.stage)).filter(Boolean))
  const distinctPhones = new Set(rows.map(row => normalizedPhone(row.phone)).filter(Boolean))
  if (distinctNames.size > 1) multipleNamedOccupantGroups++
  else if (distinctNames.size === 1 && blankNames > 0) namedBlankMixGroups++
  else if (distinctNames.size === 0) allBlankNameGroups++
  if (distinctStages.size > 1) stageChangeGroups++
  if (distinctPhones.size > 1) phoneConflictGroups++
}

const matchedIds = new Set(stableMatches.map(row => row.provider_lead_id))
const report = {
  read_only: true,
  generated_at: new Date().toISOString(),
  batch_id: batchFlag ? batchFlag.split('=').slice(1).join('=') : null,
  input_file: resolve(input),
  source_summary: source.summary || null,
  counts: {
    dom_rows: domRows.length,
    api_stable_ids_found: apiById.size,
    raw_cells_4_nonblank: domRows.filter(row => valueOrBlank(row?.raw_cells?.[4])).length,
    structurally_parseable_addresses: domRows.length - parseFailures.length,
    parser_review_addresses: parseFailures.length,
    explicit_unit_rows: explicitUnits,
    rows_with_customer_name: names,
    rows_with_phone: phones,
    stable_id_recoverable_rows: stableMatches.length,
    dom_only_rows_requiring_identity_review: domOnly.length,
    api_ids_not_matched_to_dom: apiById.size - matchedIds.size,
    unique_address_unit_groups: addressGroups.size,
    repeated_address_unit_groups: repeatedGroups,
    repeated_rows_beyond_one: repeatedExtraRows,
    groups_with_multiple_named_occupants: multipleNamedOccupantGroups,
    groups_with_named_and_blank_mix: namedBlankMixGroups,
    groups_with_all_names_blank: allBlankNameGroups,
    groups_with_stage_changes: stageChangeGroups,
    groups_with_phone_conflicts: phoneConflictGroups,
  },
  recovery_decision: {
    safe_for_automatic_provider_id_recovery: stableMatches.length,
    requires_review_before_write: domOnly.length + parseFailures.length,
    structurally_recoverable_total: domRows.length - parseFailures.length,
    reason: 'Only rows matched one-to-one to a stable SPOTIO API ID are classified as automatically safe. DOM-only rows are preserved in the report but are not written or assigned invented provider IDs.',
  },
  dom_only_preview: domOnly.slice(0, 50),
  parse_failure_preview: parseFailures.slice(0, 50),
}

const serialized = `${JSON.stringify(report, null, 2)}\n`
if (outputFlag) await writeFile(resolve(outputFlag.split('=').slice(1).join('=')), serialized, 'utf8')
process.stdout.write(serialized)
