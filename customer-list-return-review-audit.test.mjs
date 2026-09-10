import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const migration=readFileSync(new URL('./supabase/migrations/20260828044500_customer_list_return_review_audit_action.sql',import.meta.url),'utf8')
const customerList=readFileSync(new URL('./app-customer-list-approval-refresh.js',import.meta.url),'utf8')

test('NOT A SALE uses the immediate return-to-review transaction',()=>{
  assert.match(customerList,/admin_return_sale_to_review/)
  assert.match(customerList,/Sale moved immediately from Customer List to Admin SALE REVIEW/)
})

test('audit constraint preserves existing values and includes return-to-review actions',()=>{
  assert.match(migration,/pg_get_constraintdef/)
  assert.match(migration,/pg_get_functiondef/)
  assert.match(migration,/returned_to_review/)
  assert.match(migration,/customer_list_return_to_review/)
  assert.match(migration,/array_agg\(distinct value order by value\)/)
  assert.match(migration,/sale_admin_edit_history_action_check/)
})
