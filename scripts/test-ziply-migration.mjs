import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { constraintContract, loadPackage, migrationTransaction } from './ziply-release-package.mjs'

// Dedicated disposable PostgreSQL service only. Never point this test at Supabase.
assert.equal(process.env.PGDATABASE, 'ziply_release_test')
assert.ok(['127.0.0.1', 'localhost'].includes(process.env.PGHOST))
assert.equal(process.env.ZIPLY_MIGRATION_TEST, '1')
const sql = query => execFileSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim()
const release=await loadPackage(), contract=await constraintContract(release)
const transaction=migrationTransaction(release.migration)
const definition=()=>sql("select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.sales_records'::regclass and conname='sales_records_isp_check'")

// CREATE fails if the service is not clean; existing tables are never overwritten.
sql(`create schema supabase_migrations;
create table supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);
create table public.sales_records(id integer primary key, isp text not null, constraint sales_records_isp_check ${contract.before});
insert into public.sales_records values (1,'Fidium'),(2,'Quantum'),(3,'Other');`)
assert.throws(()=>sql("insert into public.sales_records values (4,'Ziply')"))
assert.throws(()=>sql("insert into public.sales_records values (5,'Unknown provider')"))

sql(transaction)
assert.equal(definition(),contract.after)
assert.equal(sql('select count(*) from public.sales_records'),'3','Existing sales must survive')
assert.equal(sql("select isp from public.sales_records where id=1"),'Fidium')
sql("insert into public.sales_records values (4,'Ziply')")
assert.throws(()=>sql("insert into public.sales_records values (5,'Unknown provider')"))
assert.equal(sql("select name from supabase_migrations.schema_migrations where version='20260911121718'"),'add_ziply_sale_provider')
assert.equal(JSON.parse(sql("select to_json(statements)::text from supabase_migrations.schema_migrations where version='20260911121718'"))[0],release.migration)
console.log('PASS: provider addition, old rows, unknown rejection, and exact migration history')

assert.throws(()=>sql(transaction),'A replay must stop without changing the already-applied release')
assert.equal(definition(),contract.after)
assert.equal(sql('select count(*) from public.sales_records'),'4')
assert.equal(sql('select count(*) from supabase_migrations.schema_migrations'),'1')
console.log('PASS: stale/repeated release stops without partial changes')

// Force a history conflict after ALTER TABLE; both constraint edits must roll back.
sql(`delete from public.sales_records where id=4;
alter table public.sales_records drop constraint sales_records_isp_check;
alter table public.sales_records add constraint sales_records_isp_check ${contract.before};`)
assert.throws(()=>sql(transaction),'Duplicate history must roll back the constraint update')
assert.equal(definition(),contract.before)
assert.equal(sql('select count(*) from public.sales_records'),'3')
assert.throws(()=>sql("insert into public.sales_records values (4,'Ziply')"))
console.log('PASS: migration-history failure rolls back the complete database change')
