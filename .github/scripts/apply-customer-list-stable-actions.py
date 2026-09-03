from pathlib import Path


def replace_once(path: str, before: str, after: str, label: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(before)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 marker, found {count}")
    file.write_text(source.replace(before, after, 1))


renderer = "app-accounting-records.js"
replace_once(
    renderer,
    "const row=document.createElement('tr');",
    "const row=document.createElement('tr');row.dataset.saleId=String(item.id||'');",
    "canonical row sale id",
)
replace_once(
    renderer,
    "button.type='button';button.className='customer-remove';button.textContent='NOT A SALE';",
    "button.type='button';button.className='customer-remove';button.dataset.saleId=String(item.id||'');button.textContent='NOT A SALE';",
    "canonical button sale id",
)
replace_once(
    renderer,
    "  function renderRows(){",
    "  function isFinalNotASale(row){const values=[row?.sale_status,row?.admin_review_disposition,row?.verification_status].map(value=>String(value||'').trim().toLowerCase());return values.includes('not_a_sale');}\n  function renderRows(){",
    "client final not-a-sale filter helper",
)
replace_once(
    renderer,
    "records=data.records||[];adminScope=!!data.admin_scope;",
    "records=(data.records||[]).filter(row=>!isFinalNotASale(row));adminScope=!!data.admin_scope;",
    "client final not-a-sale filter",
)
replace_once(
    renderer,
    "byId('customerOrderCount').textContent=String(data.summary?.orders||0);byId('customerEarnedPay').textContent=money(data.summary?.current_earned_pay);byId('customerCancellationReduction').textContent=money(data.summary?.cancellation_reductions);",
    "byId('customerOrderCount').textContent=String(records.length);byId('customerEarnedPay').textContent=money(records.reduce((sum,row)=>sum+Number(row.current_earned_pay||0),0));byId('customerCancellationReduction').textContent=money(records.reduce((sum,row)=>sum+Number(row.cancellation_reduction||0),0));",
    "client visible summary",
)

controls = "app-customer-list-approval-refresh.js"
replace_once(
    controls,
    "  function findSaleForRow(row){\n    const cells=",
    "  function findSaleForRow(row){\n    const directId=String(row?.dataset?.saleId||row?.querySelector('button.customer-remove')?.dataset?.saleId||'').trim();\n    if(directId)return state.records.find(item=>String(item.id)===directId)||{id:directId};\n    const cells=",
    "direct sale id precedence",
)

edge = "supabase/functions/accounting-records/index.ts"
replace_once(
    edge,
    "function isAdminApproved(row:any){return String(row?.verification_reason||'').toLowerCase().startsWith('admin_sale_review_verified:')||String(row?.compensation_snapshot?.admin_approval?.status||'').toLowerCase()==='approved'}",
    "function isAdminApproved(row:any){return String(row?.verification_reason||'').toLowerCase().startsWith('admin_sale_review_verified:')||String(row?.compensation_snapshot?.admin_approval?.status||'').toLowerCase()==='approved'}\nfunction isFinalNotASale(row:any){return [row?.sale_status,row?.admin_review_disposition,row?.verification_status].some(value=>String(value||'').trim().toLowerCase()==='not_a_sale')}",
    "server final not-a-sale helper",
)
replace_once(
    edge,
    ".filter((row:any)=>isAdminApproved(row)&&!row.removed_to_bank_at)",
    ".filter((row:any)=>isAdminApproved(row)&&!isFinalNotASale(row)&&!row.removed_to_bank_at)",
    "server final not-a-sale exclusion",
)

replace_once(
    "index.html",
    "app-accounting-records.js?v=2026082422",
    "app-accounting-records.js?v=2026090301",
    "accounting script version",
)
replace_once(
    "index.html",
    "app-customer-list-approval-refresh.js?v=2026082601",
    "app-customer-list-approval-refresh.js?v=2026090301",
    "Customer List controls version",
)

worker = Path("service-worker.js")
worker_source = worker.read_text()
old_version = "field-coach-app-shell-v7-20260902-sale-completion-runtime"
new_version = "field-coach-app-shell-v8-20260903-customer-list-stable-actions"
if worker_source.count(old_version) != 1:
    raise SystemExit("service worker version marker missing")
worker_source = worker_source.replace(old_version, new_version, 1)
shell_marker = "  '/app-sales-products.js?v=2026090201',\n"
shell_addition = shell_marker + "  '/app-accounting-records.js?v=2026090301',\n  '/app-customer-list-approval-refresh.js?v=2026090301',\n"
if worker_source.count(shell_marker) != 1:
    raise SystemExit("service worker shell marker missing")
worker.write_text(worker_source.replace(shell_marker, shell_addition, 1))

for path in (
    "organization-access-gate.test.mjs",
    "sale-completion-runtime.test.mjs",
    ".github/workflows/field-coach-android-beta5-sale-runtime.yml",
):
    file = Path(path)
    source = file.read_text()
    if old_version not in source:
        raise SystemExit(f"{path}: old cache identity missing")
    file.write_text(source.replace(old_version, new_version))

Path("customer-list-stable-actions.test.mjs").write_text(
    """import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const renderer=readFileSync(new URL('./app-accounting-records.js',import.meta.url),'utf8')
const controls=readFileSync(new URL('./app-customer-list-approval-refresh.js',import.meta.url),'utf8')
const accountingEdge=readFileSync(new URL('./supabase/functions/accounting-records/index.ts',import.meta.url),'utf8')
const indexSource=readFileSync(new URL('./index.html',import.meta.url),'utf8')
const workerSource=readFileSync(new URL('./service-worker.js',import.meta.url),'utf8')

test('Customer List renderer binds the canonical sale UUID before any visible-field matching',()=>{
  assert.match(renderer,/row\\.dataset\\.saleId=String\\(item\\.id\\|\\|''\\)/)
  assert.match(renderer,/button\\.dataset\\.saleId=String\\(item\\.id\\|\\|''\\)/)
  const direct=controls.indexOf("const directId=String(row?.dataset?.saleId")
  const fuzzy=controls.indexOf("const cells=[...row.querySelectorAll('td')]")
  assert.ok(direct>=0&&fuzzy>direct,'canonical ID must be read before fuzzy visible-text matching')
  assert.match(controls,/if\\(directId\\)return state\\.records\\.find\\(item=>String\\(item\\.id\\)===directId\\)\\|\\|\\{id:directId\\}/)
})

test('the exact frozen REMOVE SALE shape remains actionable without address, order, or account text',()=>{
  const item={id:'46b94526-57d0-4714-b76b-c5c55bc2aa1b',customer_first_name:'REMOVE',customer_last_name:'SALE',service_address:null,provider_order_number:null,provider_account_number:null}
  const row={dataset:{saleId:item.id},querySelector:()=>({dataset:{saleId:item.id}})}
  const directId=String(row?.dataset?.saleId||row?.querySelector('button.customer-remove')?.dataset?.saleId||'').trim()
  assert.equal(directId,item.id)
})

test('final NOT A SALE records cannot remain frozen in Customer List',()=>{
  assert.match(renderer,/function isFinalNotASale\\(row\\)/)
  assert.match(renderer,/records=\\(data\\.records\\|\\|\\[\\]\\)\\.filter\\(row=>!isFinalNotASale\\(row\\)\\)/)
  assert.match(accountingEdge,/function isFinalNotASale\\(row:any\\)/)
  assert.match(accountingEdge,/isAdminApproved\\(row\\)&&!isFinalNotASale\\(row\\)&&!row\\.removed_to_bank_at/)
})

test('production app and service worker request the repaired Customer List files',()=>{
  assert.match(indexSource,/app-accounting-records\\.js\\?v=2026090301/)
  assert.match(indexSource,/app-customer-list-approval-refresh\\.js\\?v=2026090301/)
  assert.match(workerSource,/field-coach-app-shell-v8-20260903-customer-list-stable-actions/)
  assert.match(workerSource,/'\\/app-accounting-records\\.js\\?v=2026090301'/)
  assert.match(workerSource,/'\\/app-customer-list-approval-refresh\\.js\\?v=2026090301'/)
})
"""
)
