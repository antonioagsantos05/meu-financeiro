// Read-only audit of application sources; all database writes are in disposable PGlite.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const db = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111'
const results = []
async function command(operation, payload) {
  const result = await db.query(
    'select command($1,$2::jsonb,$3::uuid) as result',
    [operation, JSON.stringify(payload), randomUUID()],
  )
  return result.rows[0].result
}
try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values('${owner}');
    select set_config('request.jwt.claim.sub','${owner}',false);`)
  await db.exec(readFileSync('supabase/migrations/202611030001_initial.sql', 'utf8').replace('create extension if not exists pgcrypto;', ''))
  await db.exec('set role authenticated')
  const account = (await command('save_account', {
    name: 'Audit account', bank_code: 'Nubank', opening_balance_cents: 100000,
    overdraft_limit_cents: 0,
  })).id

  await command('save_account', {
    id: account, version: 1, name: 'Audit account', bank_code: 'Itaú',
    opening_balance_cents: 100000, overdraft_limit_cents: 0,
  })
  results.push({ id: 'A-04', issue: 'Bank edit silently ignored', expected: 'Itaú', observed: (await db.query('select bank_code from accounts where id=$1', [account])).rows[0].bank_code })

  const rule = (await command('save_recurrence', {
    description: 'Audit monthly income', kind: 'income', amount_cents: 10000,
    account_id: account, day: 5, start_on: '2026-01-01',
  })).id
  await command('generate_recurrences', {start_on: '2026-01-01', end_on: '2026-01-31'})
  await command('save_recurrence', {
    id: rule, description: 'Audit monthly income', amount_cents: 10000,
    day: 10, active: true,
  })
  await command('generate_recurrences', {start_on: '2026-01-01', end_on: '2026-01-31'})
  const occurrences = await db.query('select occurrence_date::text from recurrence_occurrences where rule_id=$1 order by occurrence_date', [rule])
  results.push({id: 'A-02', issue: 'Duplicate monthly recurrence after day edit', expected_count: 1, observed_dates: occurrences.rows.map(r=>r.occurrence_date)})

  const card = (await command('save_card', {
    name: 'Audit card', account_id: account, closing_day: 10, due_day: 20,
  })).id
  const payload = {
    kind: 'expense', description: 'Audit purchase', amount_cents: 10000,
    occurred_on: '2025-01-01', status: 'confirmed', payment_method: 'credit',
    account_id: null, card_id: card, installment_count: 1, tag_ids: [],
  }
  const purchase = (await command('create_transaction', payload)).id
  const plan = (await db.query('select id from installment_plans where transaction_id=$1', [purchase])).rows[0].id
  const invoice = (await db.query('select invoice_id from installments where plan_id=$1', [plan])).rows[0].invoice_id
  await command('pay_invoice', {id: invoice, account_id: account, amount_cents: 10000, paid_on: '2025-01-20'})
  try {
    await command('update_transaction', {...payload, id: purchase, version: 1, description: 'Only rename'})
    results.push({id: 'A-05', issue: 'Paid purchase metadata edit', observed: 'accepted'})
  } catch (error) {
    results.push({id: 'A-05', issue: 'Paid purchase metadata edit', expected: 'allow name/tags without changing financial records', observed: error.message})
  }
  results.push({id: 'A-06', issue: 'Plan remains open after last invoice paid', expected: 'closed/paid', observed: (await db.query('select status from installment_plans where id=$1', [plan])).rows[0].status})
  console.log(JSON.stringify({environment: 'disposable PGlite; no production writes', results}, null, 2))
} finally {
  await db.close()
}
