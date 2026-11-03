import { beforeAll, afterAll, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const db = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111'
let santander: string, nubank: string, itau: string, card: string
async function command(operation: string, payload: object) {
  const response = await db.query<{ result: { id: string } }>(
    'select command($1,$2::jsonb,$3::uuid) as result',
    [operation, JSON.stringify(payload), randomUUID()],
  )
  return response.rows[0].result
}
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
    insert into auth.users values('${owner}');select set_config('request.jwt.claim.sub','${owner}',false);`)
  await db.exec(
    readFileSync(
      'supabase/migrations/202611030001_initial.sql',
      'utf8',
    ).replace('create extension if not exists pgcrypto;', ''),
  )
  // Preserve an old account with a real historical balance; migration must not erase it.
  await db.exec(
    `insert into accounts(owner_id,name,bank_code,opening_balance_cents) values('${owner}','Histórico','Nubank',1234)`,
  )
  await db.exec(
    readFileSync(
      'supabase/migrations/202611030003_santander_cash_account.sql',
      'utf8',
    ),
  )
  await db.exec('set role authenticated')
  const createAccount = async (bank: string, balance = 0) =>
    (
      await command('save_account', {
        name: bank,
        bank_code: bank,
        opening_balance_cents: balance,
        overdraft_limit_cents: 0,
      })
    ).id
  santander = await createAccount('Santander', 100000)
  nubank = await createAccount('Nubank')
  itau = await createAccount('Itaú')
  card = (
    await command('save_card', {
      name: 'Nubank crédito',
      account_id: santander,
      closing_day: 10,
      due_day: 20,
    })
  ).id
}, 60000)
afterAll(async () => {
  await db.close()
})
const transaction = (account_id: string, payment_method = 'pix') => ({
  kind: 'expense',
  description: 'Compra',
  amount_cents: 5000,
  occurred_on: '2026-01-01',
  status: 'confirmed',
  payment_method,
  account_id,
  tag_ids: [],
})
it('permite PIX/débito no Santander e rejeita nos outros bancos', async () => {
  for (const method of ['pix', 'debit']) {
    await command('create_transaction', transaction(santander, method))
    for (const account of [nubank, itau])
      await expect(
        command('create_transaction', transaction(account, method)),
      ).rejects.toThrow('Santander')
  }
  const balances = await db.query<{
    account_id: string
    balance_cents: number
  }>('select * from get_account_balances()')
  expect(
    Number(
      balances.rows.find((a) => a.account_id === santander)!.balance_cents,
    ),
  ).toBe(90000)
  for (const id of [nubank, itau])
    expect(
      Number(balances.rows.find((a) => a.account_id === id)!.balance_cents),
    ).toBe(0)
})
it('cartão Nubank não debita conta; fatura exige Santander', async () => {
  const purchase = await command('create_transaction', {
    ...transaction(santander),
    payment_method: 'credit',
    account_id: null,
    card_id: card,
    installment_count: 1,
  })
  const invoice = (
    await db.query<{ invoice_id: string }>(
      'select it.invoice_id from installments it join installment_plans p on p.id=it.plan_id where p.transaction_id=$1',
      [purchase.id],
    )
  ).rows[0].invoice_id
  await expect(
    command('pay_invoice', {
      id: invoice,
      account_id: nubank,
      amount_cents: 5000,
      paid_on: '2026-01-20',
    }),
  ).rejects.toThrow('Santander')
  await command('pay_invoice', {
    id: invoice,
    account_id: santander,
    amount_cents: 5000,
    paid_on: '2026-01-20',
  })
})
it('não permite novos saldos iniciais ou recorrências bancárias em Nubank/Itaú', async () => {
  await expect(
    command('save_account', {
      name: 'Nova',
      bank_code: 'Itaú',
      opening_balance_cents: 1000,
      overdraft_limit_cents: 0,
    }),
  ).rejects.toThrow('zerados')
  await expect(
    command('save_recurrence', {
      description: 'Assinatura',
      kind: 'expense',
      amount_cents: 1000,
      account_id: nubank,
      day: 5,
      start_on: '2026-01-01',
    }),
  ).rejects.toThrow('Santander')
  await expect(
    command('create_transaction', {
      ...transaction(santander),
      kind: 'transfer',
      payment_method: 'transfer',
      destination_account_id: itau,
    }),
  ).rejects.toThrow('transferências')
})
it('preserva saldos históricos ao instalar a migração', async () => {
  const rows = await db.query<{ opening_balance_cents: number }>(
    "select opening_balance_cents from accounts where name='Histórico'",
  )
  expect(Number(rows.rows[0].opening_balance_cents)).toBe(1234)
})
