import { beforeAll, afterAll, describe, it, expect } from 'vitest'

import { PGlite } from '@electric-sql/pglite'

import { readFileSync } from 'node:fs'

import { randomUUID } from 'node:crypto'

const db = new PGlite()

const u = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222'

async function cmd(op: string, payload: object, key = randomUUID()) {
  const r = await db.query<{ result: { id: string } }>(
    'select public.command($1,$2::jsonb,$3::uuid) result',
    [op, JSON.stringify(payload), key],
  )
  return r.rows[0].result
}

let account: string, destination: string, card: string

beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;insert into auth.users values('${u}'),('${other}');select set_config('request.jwt.claim.sub','${u}',false);`,
  )

  await db.exec(
    readFileSync(
      'supabase/migrations/202611030001_initial.sql',
      'utf8',
    ).replace('create extension if not exists pgcrypto;', ''),
  )

  await db.exec(
    readFileSync('supabase/migrations/202611030002_push.sql', 'utf8'),
  )
  await db.exec('set role authenticated')

  account = (
    await cmd('save_account', {
      name: 'Teste Nubank',
      bank_code: 'Nubank',
      opening_balance_cents: 100000,
      overdraft_limit_cents: 0,
    })
  ).id

  destination = (
    await cmd('save_account', {
      name: 'Teste Itaú',
      bank_code: 'Itaú',
      opening_balance_cents: 0,
      overdraft_limit_cents: 0,
    })
  ).id

  card = (
    await cmd('save_card', {
      name: 'Teste cartão',
      account_id: account,
      closing_day: 10,
      due_day: 20,
    })
  ).id
}, 60000)

afterAll(async () => {
  await db.close()
})

const tx = (extra: object = {}) => ({
  kind: 'expense',
  description: 'Teste',
  amount_cents: 5000,
  occurred_on: '2026-01-03',
  status: 'confirmed',
  payment_method: 'pix',
  account_id: account,
  tag_ids: [],
  ...extra,
})

async function real(id?: string) {
  const r = await db.query<{ real_cents: number }>(
    'select * from get_forecast($1::date,$1::date,$2::uuid[],0)',
    ['2026-01-31', id ? [id] : null],
  )
  return Number(r.rows[0].real_cents)
}

describe('migração e invariantes reais em PostgreSQL embarcado', () => {
  it('PIX baixa apenas a conta selecionada e idempotência não duplica', async () => {
    const k = randomUUID()
    await cmd('create_transaction', tx(), k)
    await cmd('create_transaction', tx(), k)
    expect(await real(account)).toBe(95000)
    expect(await real(destination)).toBe(0)
    await expect(
      cmd('create_transaction', tx({ amount_cents: 6000 }), k),
    ).rejects.toThrow()
  })

  it('transferência mantém consolidado', async () => {
    const before = await real()
    await cmd(
      'create_transaction',
      tx({
        kind: 'transfer',
        payment_method: 'transfer',
        destination_account_id: destination,
        amount_cents: 10000,
      }),
    )
    expect(await real()).toBe(before)
    expect(await real(destination)).toBe(10000)
  })

  it('crédito gera parcelas exatas e não debita conta; pagamento debita uma vez', async () => {
    const before = await real()
    const t = await cmd(
      'create_transaction',
      tx({
        amount_cents: 10000,
        payment_method: 'credit',
        account_id: null,
        card_id: card,
        installment_count: 3,
      }),
    )
    expect(await real()).toBe(before)
    const rows = await db.query<{ amount_cents: number; invoice_id: string }>(
      `select it.amount_cents,it.invoice_id from installments it join installment_plans p on p.id=it.plan_id where p.transaction_id=$1 order by ordinal`,
      [t.id],
    )
    expect(rows.rows.map((r) => Number(r.amount_cents))).toEqual([
      3334, 3333, 3333,
    ])
    const invoice = rows.rows[0].invoice_id,
      k = randomUUID()
    const pay = {
      id: invoice,
      account_id: account,
      amount_cents: 3334,
      paid_on: '2026-01-20',
    }
    await cmd('pay_invoice', pay, k)
    await cmd('pay_invoice', pay, k)
    expect(await real()).toBe(before - 3334)
    await expect(
      cmd('delete_transaction', { id: t.id, version: 1, reason: 'teste' }),
    ).rejects.toThrow()
  })

  it('recorrências não duplicam e não afetam saldo real', async () => {
    await cmd('save_recurrence', {
      description: 'Salário teste',
      kind: 'income',
      amount_cents: 600000,
      account_id: account,
      day: 31,
      start_on: '2026-02-01',
    })
    const before = await real()
    await cmd('generate_recurrences', {
      start_on: '2026-02-01',
      end_on: '2026-03-31',
    })
    await cmd('generate_recurrences', {
      start_on: '2026-02-01',
      end_on: '2026-03-31',
    })
    const r = await db.query<{ occurrence_date: string }>(
      'select occurrence_date::text from recurrence_occurrences order by occurrence_date',
    )
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].occurrence_date).toBe('2026-02-28')
    expect(await real()).toBe(before)
  })

  it('versão impede perda de atualização e exclusão preserva auditoria', async () => {
    const t = await cmd('create_transaction', tx({ description: 'Editar' }))
    await cmd('update_transaction', {
      ...tx({ description: 'Editado' }),
      id: t.id,
      version: 1,
    })
    await expect(
      cmd('update_transaction', { ...tx(), id: t.id, version: 1 }),
    ).rejects.toThrow()
    await cmd('delete_transaction', {
      id: t.id,
      version: 2,
      reason: 'Correção',
    })
    const r = await db.query('select * from audit_events where entity_id=$1', [
      t.id,
    ])
    expect(r.rows.length).toBeGreaterThan(2)
  })

  it('RLS nega leitura e escrita cruzadas e escrita direta', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ])
    expect((await db.query('select * from accounts')).rows).toHaveLength(0)
    await expect(cmd('create_transaction', tx())).rejects.toThrow()
    await expect(
      db.query('update accounts set opening_balance_cents=1'),
    ).rejects.toThrow()
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [u])
  })

  it('falha de parcela faz rollback de todo o movimento', async () => {
    const before = (await db.query('select * from transactions')).rows.length
    await expect(
      cmd(
        'create_transaction',
        tx({
          payment_method: 'credit',
          account_id: null,
          card_id: card,
          installment_count: 0,
        }),
      ),
    ).rejects.toThrow()
    expect((await db.query('select * from transactions')).rows).toHaveLength(
      before,
    )
  })

  it('quitação com desconto preserva parcela paga e não debita duas vezes', async () => {
    const t = await cmd(
      'create_transaction',
      tx({
        description: 'Quitar',
        amount_cents: 60000,
        occurred_on: '2025-05-01',
        payment_method: 'credit',
        account_id: null,
        card_id: card,
        installment_count: 3,
      }),
    )
    const plans = await db.query<{ id: string }>(
      'select id from installment_plans where transaction_id=$1',
      [t.id],
    )
    const id = plans.rows[0].id
    const parts = await db.query<{ invoice_id: string }>(
      'select invoice_id from installments where plan_id=$1 order by ordinal',
      [id],
    )
    await cmd('pay_invoice', {
      id: parts.rows[0].invoice_id,
      account_id: account,
      amount_cents: 20000,
      paid_on: '2025-05-20',
    })
    const before = Number(
      (
        await db.query<{ balance_cents: number }>(
          'select balance_cents from get_account_balances() where account_id=$1',
          [account],
        )
      ).rows[0].balance_cents,
    )
    const key = randomUUID(),
      payload = {
        id,
        version: 1,
        amount_cents: 35000,
        account_id: account,
        paid_on: '2025-06-01',
        issuer_confirmed: true,
      }
    await cmd('settle_installment_plan', payload, key)
    await cmd('settle_installment_plan', payload, key)
    const rows = await db.query<{ status: string }>(
      'select status from installments where plan_id=$1 order by ordinal',
      [id],
    )
    expect(rows.rows.map((r) => r.status)).toEqual([
      'paid',
      'settled',
      'settled',
    ])
    const after = Number(
      (
        await db.query<{ balance_cents: number }>(
          'select balance_cents from get_account_balances() where account_id=$1',
          [account],
        )
      ).rows[0].balance_cents,
    )
    expect(after).toBe(before - 35000)
    await expect(cmd('settle_installment_plan', payload)).rejects.toThrow()
    const audit = await db.query<{ after_json: { adjustment_cents: number } }>(
      "select after_json from audit_events where entity_id=$1 and action='settlement_adjustment'",
      [id],
    )
    expect(audit.rows[0].after_json.adjustment_cents).toBe(-5000)
  })
  it('pagamento parcial bloqueia alteração e baixa apenas valor real', async () => {
    const t = await cmd(
      'create_transaction',
      tx({
        amount_cents: 10000,
        occurred_on: '2024-01-10',
        payment_method: 'credit',
        account_id: null,
        card_id: card,
        installment_count: 1,
      }),
    )
    const rows = await db.query<{ invoice_id: string; due_on: string }>(
      `select it.invoice_id,it.due_on::text from installments it join installment_plans p on p.id=it.plan_id where p.transaction_id=$1`,
      [t.id],
    )
    expect(rows.rows[0].due_on).toBe('2024-02-20')
    await cmd('pay_invoice', {
      id: rows.rows[0].invoice_id,
      account_id: account,
      amount_cents: 1000,
      paid_on: '2024-02-20',
    })
    await expect(
      cmd('update_transaction', { ...tx(), id: t.id, version: 1 }),
    ).rejects.toThrow()
    const invoice = await db.query<{ paid_cents: number; status: string }>(
      'select * from invoices where id=$1',
      [rows.rows[0].invoice_id],
    )
    expect(Number(invoice.rows[0].paid_cents)).toBe(1000)
    expect(invoice.rows[0].status).toBe('partial')
  })
  it('não aceita edição sem versão esperada', async () => {
    const t = await cmd('create_transaction', tx())
    await expect(
      cmd('update_transaction', { ...tx(), id: t.id }),
    ).rejects.toThrow()
  })
  it('registra push privado e horários iniciais, e revoga dispositivos', async () => {
    await expect(
      db.query('select save_push_subscription($1::jsonb)', [
        JSON.stringify({
          endpoint: 'https://example.org',
          keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) },
        }),
      ]),
    ).rejects.toThrow()
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/test',
      keys: { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) },
    }
    await db.query('select save_push_subscription($1::jsonb)', [
      JSON.stringify(subscription),
    ])
    await db.query('select save_push_subscription($1::jsonb)', [
      JSON.stringify(subscription),
    ])
    expect(
      (await db.query('select * from push_subscriptions')).rows,
    ).toHaveLength(1)
    expect((await db.query('select * from reminder_rules')).rows).toHaveLength(
      2,
    )
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ])
    expect(
      (await db.query('select * from push_subscriptions')).rows,
    ).toHaveLength(0)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [u])
    await db.query('select revoke_push_subscriptions()')
    expect(
      (
        await db.query(
          'select * from push_subscriptions where revoked_at is null',
        )
      ).rows,
    ).toHaveLength(0)
  })
  it('unicidade de entrega impede duplicata por regra e data', async () => {
    const rule = (
      await db.query<{ id: string }>('select id from reminder_rules limit 1')
    ).rows[0].id
    await db.exec('reset role')
    await db.query(
      "insert into reminder_deliveries(owner_id,rule_id,local_date,scheduled_time,status) values($1,$2,'2026-11-03','13:30','claimed')",
      [u, rule],
    )
    await expect(
      db.query(
        "insert into reminder_deliveries(owner_id,rule_id,local_date,scheduled_time,status) values($1,$2,'2026-11-03','13:30','claimed')",
        [u, rule],
      ),
    ).rejects.toThrow()
    await db.exec('set role authenticated')
  })
})
