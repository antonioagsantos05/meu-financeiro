import { beforeAll, afterAll, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
const db = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
// Synthetic fixture: does not include the user's financial package.
const fixture = {
  metadados: {
    versao: '1.0',
    recebimentos_novembro: [
      {
        descricao: 'Receita teste',
        valor_centavos: 100000,
        data: '2030-01-30',
        data_confirmada: false,
      },
    ],
  },
  contas: ['Nubank', 'Santander', 'Itaú'].map((nome) => ({
    id: 'conta_' + nome,
    nome,
  })),
  cartoes: [
    { id: 'cartao_nubank', fechamento_dia: '', vencimento_dia: 15 },
    { id: 'cartao_santander', fechamento_dia: 25, vencimento_dia: 1 },
    { id: 'cartao_itau', fechamento_dia: 1, vencimento_dia: 3 },
  ],
  compromissos: [
    {
      id: 'nubank_teste',
      tipo: 'fatura',
      cartao_id: 'cartao_nubank',
      descricao: 'Fatura teste',
      valor_centavos: 10001,
      data_vencimento: '2030-01-15',
    },
    {
      id: 'santander_teste',
      tipo: 'fatura',
      cartao_id: 'cartao_santander',
      descricao: 'Fatura teste 2',
      valor_centavos: 20002,
      data_vencimento: '2030-01-01',
    },
    {
      id: 'emprestimo_teste',
      tipo: 'emprestimo',
      descricao: 'Parcela teste',
      valor_centavos: 30003,
      data_vencimento: '2030-01-15',
    },
    {
      id: 'itau_2027-04-05',
      tipo: 'fatura',
      cartao_id: 'cartao_itau',
      descricao: 'Cobrança possivelmente duplicada',
      valor_centavos: 1234,
      data_vencimento: '2027-04-05',
    },
  ],
  recorrencias: [
    {
      id: 'assinatura_teste',
      tipo: 'assinatura_cartao',
      descricao: 'Serviço teste',
      valor_centavos: 1234,
      dia_mes: 4,
      cartao_id: 'cartao_santander',
    },
    {
      id: 'psicologa_teste',
      tipo: 'despesa',
      descricao: 'Sessão teste',
      valor_centavos: 4567,
      dia_mes: '',
    },
    {
      id: 'salario_teste',
      tipo: 'receita',
      descricao: 'Salário teste',
      valor_centavos: 100000,
      dia_mes: '',
    },
  ],
}
async function load(payload: object = fixture, key = 'test-package') {
  return db.query('select import_financial_package($1::jsonb,$2,$3) result', [
    JSON.stringify(payload),
    key,
    12345,
  ])
}
beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 insert into auth.users values('${owner}'),('${other}');select set_config('request.jwt.claim.sub','${owner}',false);`)
  for (const file of [
    '202611030001_initial.sql',
    '202611030003_santander_cash_account.sql',
    '202611030004_financial_import.sql',
    '202611030005_forecast_expected_income.sql',
    '202611030006_payments_and_recurrences.sql',
    '202611030007_edit_financial_events.sql',
    '202611030008_recurrence_tags_and_schedule.sql',
  ])
    await db.exec(
      readFileSync('supabase/migrations/' + file, 'utf8').replace(
        'create extension if not exists pgcrypto;',
        '',
      ),
    )
  await db.exec('set role authenticated')
}, 60000)
afterAll(async () => {
  await db.close()
})
it('importa somente dados operacionais definidos e preserva desconhecidos', async () => {
  await load()
  const balances = await db.query<{ bank_code: string; balance_cents: number }>(
    'select a.bank_code,b.balance_cents from get_account_balances() b join accounts a on a.id=b.account_id',
  )
  expect(
    Number(
      balances.rows.find((r) => r.bank_code === 'Santander')!.balance_cents,
    ),
  ).toBe(12345)
  expect(
    balances.rows
      .filter((r) => r.bank_code !== 'Santander')
      .every((r) => Number(r.balance_cents) === 0),
  ).toBe(true)
  expect((await db.query('select * from invoices')).rows).toHaveLength(2)
  expect((await db.query('select * from transactions')).rows).toHaveLength(1)
  expect((await db.query('select * from recurrence_rules')).rows).toHaveLength(
    0,
  )
  expect(
    (
      await db.query(
        "select * from cards where name='Nubank' and closing_day is null",
      )
    ).rows,
  ).toHaveLength(1)
  expect(
    (
      await db.query(
        "select * from financial_import_records where source_key='itau_2027-04-05' and linked_id is null and needs_review",
      )
    ).rows,
  ).toHaveLength(1)
})
it('repetir pacote não duplica; chave com dados diferentes é rejeitada', async () => {
  const before = (await db.query('select * from financial_import_records')).rows
    .length
  await load()
  expect(
    (await db.query('select * from financial_import_records')).rows,
  ).toHaveLength(before)
  await expect(
    load({ ...fixture, metadados: { versao: '1.0', extra: true } }),
  ).rejects.toThrow('outros dados')
})
it('nova compra em cartão sem fechamento é rejeitada', async () => {
  const card = (
    await db.query<{ id: string }>("select id from cards where name='Nubank'")
  ).rows[0].id
  await expect(
    db.query(
      "select command('create_transaction',$1::jsonb,gen_random_uuid())",
      [
        JSON.stringify({
          kind: 'expense',
          description: 'Teste',
          amount_cents: 100,
          occurred_on: '2030-01-01',
          status: 'confirmed',
          payment_method: 'credit',
          card_id: card,
          installment_count: 1,
          tag_ids: [],
        }),
      ],
    ),
  ).rejects.toThrow('fechamento')
})
it('pacote inválido faz rollback, sem modificar dados existentes', async () => {
  const before = (await db.query('select * from financial_imports')).rows.length
  await expect(
    load(
      {
        ...fixture,
        compromissos: [
          ...fixture.compromissos,
          { id: 'invalid', tipo: 'despesa', valor_centavos: -1 },
        ],
      },
      'invalid',
    ),
  ).rejects.toThrow('inválido')
  expect((await db.query('select * from financial_imports')).rows).toHaveLength(
    before,
  )
})
it('RLS isola dados importados e bloqueia escrita direta', async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other])
  expect(
    (await db.query('select * from financial_import_records')).rows,
  ).toHaveLength(0)
  await expect(
    db.query('delete from financial_import_records'),
  ).rejects.toThrow()
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner])
})
it('não sobrescreve saldo movimentado nem recria contas/cartões existentes', async () => {
  const account = (
    await db.query<{ id: string }>(
      "select id from accounts where bank_code='Santander'",
    )
  ).rows[0].id
  await db.query(
    "select command('create_transaction',$1::jsonb,gen_random_uuid())",
    [
      JSON.stringify({
        kind: 'expense',
        description: 'Movimento existente',
        amount_cents: 100,
        occurred_on: '2020-01-01',
        status: 'confirmed',
        payment_method: 'pix',
        account_id: account,
        tag_ids: [],
      }),
    ],
  )
  await load(fixture, 'second-package')
  expect((await db.query('select * from accounts')).rows).toHaveLength(3)
  expect((await db.query('select * from cards')).rows).toHaveLength(3)
  const balance = (
    await db.query<{ balance_cents: number }>(
      'select balance_cents from get_account_balances() where account_id=$1',
      [account],
    )
  ).rows[0].balance_cents
  expect(Number(balance)).toBe(12245)
  expect(
    (
      await db.query(
        "select * from financial_import_records where record_type='account' and needs_review",
      )
    ).rows.length,
  ).toBeGreaterThan(0)
})
it('entrada com data provisória aumenta somente a projeção, sem duplicar entre pacotes', async () => {
  const balances = await db.query<{ balance_cents: number }>(
    'select balance_cents from get_account_balances()',
  )
  const real = balances.rows.reduce(
    (sum, row) => sum + Number(row.balance_cents),
    0,
  )
  const result = await db.query<{
    real_cents: number
    projected_cents: number
  }>("select * from get_forecast('2030-01-31','2030-01-31',null,0)")
  expect(Number(result.rows[0].real_cents)).toBe(real)
  expect(Number(result.rows[0].projected_cents)).toBe(
    real - 10001 - 20002 - 30003 + 100000,
  )
  expect(
    (await db.query("select * from transactions where kind='income'")).rows,
  ).toHaveLength(0)
  const otherAccount = (
    await db.query<{ id: string }>(
      "select id from accounts where bank_code='Nubank'",
    )
  ).rows[0].id
  const isolated = await db.query<{ projected_cents: number }>(
    "select * from get_forecast('2030-01-31','2030-01-31',$1::uuid[],0)",
    [[otherAccount]],
  )
  expect(Number(isolated.rows[0].projected_cents)).toBe(0)
})
async function manage(action: string, payload: object, key?: string) {
  const { randomUUID } = await import('node:crypto')
  return db.query('select manage_finance($1,$2::jsonb,$3::uuid)', [
    action,
    JSON.stringify(payload),
    key || randomUUID(),
  ])
}
async function currentCash() {
  return Number(
    (
      await db.query<{ balance_cents: number }>(
        "select b.balance_cents from get_account_balances() b join accounts a on a.id=b.account_id where a.bank_code='Santander'",
      )
    ).rows[0].balance_cents,
  )
}
it('desfaz pagamento de fatura uma vez, reabre fatura e preserva histórico', async () => {
  const { randomUUID } = await import('node:crypto')
  const account = (
    await db.query<{ id: string }>(
      "select id from accounts where bank_code='Santander'",
    )
  ).rows[0].id
  const invoice = (
    await db.query<{ id: string }>(
      'select id from invoices where total_cents=10001',
    )
  ).rows[0].id
  const before = await currentCash()
  await db.query("select command('pay_invoice',$1::jsonb,gen_random_uuid())", [
    JSON.stringify({
      id: invoice,
      account_id: account,
      amount_cents: 10001,
      paid_on: '2020-01-20',
    }),
  ])
  expect(await currentCash()).toBe(before - 10001)
  const payment = (
    await db.query<{ id: string }>(
      'select id from payments where invoice_id=$1',
      [invoice],
    )
  ).rows[0].id
  const key = randomUUID(),
    payload = { id: payment, reason: 'Pagamento marcado por engano' }
  await manage('reverse_payment', payload, key)
  await manage('reverse_payment', payload, key)
  expect(await currentCash()).toBe(before)
  expect(
    (
      await db.query<{ status: string }>(
        'select status from invoices where id=$1',
        [invoice],
      )
    ).rows[0].status,
  ).toBe('open')
  expect(
    (
      await db.query(
        'select * from payments where id=$1 and reversed_at is not null',
        [payment],
      )
    ).rows,
  ).toHaveLength(1)
  await expect(manage('reverse_payment', payload)).rejects.toThrow('desfeito')
  const forecast = (
    await db.query<{ real_cents: number }>(
      "select * from get_forecast('2030-01-31','2030-01-31',null,0)",
    )
  ).rows[0]
  expect(Number(forecast.real_cents)).toBe(before)
})
it('confirma e desfaz despesa sem perder vencimento original', async () => {
  const tx = (
    await db.query<{ id: string; version: number }>(
      "select id,version from transactions where description='Parcela teste'",
    )
  ).rows[0]
  const before = await currentCash()
  await manage('confirm_transaction', { ...tx, paid_on: '2020-02-01' })
  expect(await currentCash()).toBe(before - 30003)
  expect(
    (
      await db.query<{ due: string }>(
        'select occurred_on::text due from transactions where id=$1',
        [tx.id],
      )
    ).rows[0].due,
  ).toBe('2030-01-15')
  await manage('unconfirm_transaction', {
    id: tx.id,
    version: tx.version + 1,
    reason: 'Engano',
  })
  expect(await currentCash()).toBe(before)
})
it('edita assinatura sem criar débito extra e mantém regra mensal sem duplicar competência', async () => {
  const sub = (
    await db.query<{ id: string; version: number }>(
      "select id,version from financial_import_records where source_key='assinatura_teste' order by id limit 1",
    )
  ).rows[0]
  const before = (await db.query('select * from transactions')).rows.length
  await manage('edit_imported_recurrence', {
    ...sub,
    name: 'Assinatura editada',
    amount_cents: 1500,
    day: 4,
    active: true,
  })
  expect((await db.query('select * from transactions')).rows).toHaveLength(
    before,
  )
  const source = (
    await db.query<{ id: string; version: number }>(
      "select id,version from financial_import_records where source_key='salario_teste' order by id limit 1",
    )
  ).rows[0]
  await manage('edit_imported_recurrence', {
    ...source,
    name: 'Salário novo',
    amount_cents: 123400,
    day: 10,
    active: true,
  })
  const first = (
    await db.query<{ payload: { operational_rule_ids: string[] } }>(
      'select payload from financial_import_records where id=$1',
      [source.id],
    )
  ).rows[0].payload.operational_rule_ids
  await db.query(
    "select command('generate_recurrences',$1::jsonb,gen_random_uuid())",
    [JSON.stringify({ start_on: '2030-02-01', end_on: '2030-02-28' })],
  )
  await manage('edit_imported_recurrence', {
    id: source.id,
    version: source.version + 1,
    name: 'Salário novo',
    amount_cents: 123400,
    day: 20,
    active: true,
  })
  const second = (
    await db.query<{ payload: { operational_rule_ids: string[] } }>(
      'select payload from financial_import_records where id=$1',
      [source.id],
    )
  ).rows[0].payload.operational_rule_ids
  expect(second).toEqual(first)
  await db.query(
    "select command('generate_recurrences',$1::jsonb,gen_random_uuid())",
    [JSON.stringify({ start_on: '2030-02-01', end_on: '2030-02-28' })],
  )
  expect(
    (
      await db.query('select * from recurrence_occurrences where rule_id=$1', [
        first[0],
      ])
    ).rows,
  ).toHaveLength(1)
})
async function edit(entity: string, id: string, patch: object, version = 1) {
  const { randomUUID } = await import('node:crypto')
  return db.query(
    'select edit_financial_event($1,$2::uuid,$3::jsonb,$4,$5::uuid)',
    [entity, id, JSON.stringify(patch), version, randomUUID()],
  )
}
it('edita valor e data de saída confirmada com correção auditada', async () => {
  const tx = (
    await db.query<{ id: string; version: number }>(
      "select id,version from transactions where description='Movimento existente'",
    )
  ).rows[0]
  const account = (
    await db.query<{ id: string }>(
      "select id from accounts where bank_code='Santander'",
    )
  ).rows[0].id
  const before = await currentCash()
  await edit(
    'transaction',
    tx.id,
    {
      name: 'Movimento corrigido',
      amount_cents: 200,
      date: '2020-01-02',
      kind: 'expense',
      payment_method: 'pix',
      account_id: account,
      tag_ids: [],
    },
    tx.version,
  )
  expect(await currentCash()).toBe(before - 100)
  await expect(
    edit(
      'transaction',
      tx.id,
      {
        name: 'Obsoleto',
        amount_cents: 100,
        date: '2020-01-02',
        kind: 'expense',
        payment_method: 'pix',
        account_id: account,
        tag_ids: [],
      },
      tx.version,
    ),
  ).rejects.toThrow('alterado')
  expect(
    (
      await db.query(
        "select * from audit_events where entity_id=$1 and action='edit_with_correction'",
        [tx.id],
      )
    ).rows,
  ).toHaveLength(1)
})
it('edita fatura e pagamento sem duplicar o caixa', async () => {
  const invoice = (
    await db.query<{ id: string; version: number }>(
      'select id,version from invoices where total_cents=20002',
    )
  ).rows[0]
  await edit(
    'invoice',
    invoice.id,
    { name: 'Fatura editada', amount_cents: 25000, date: '2030-01-02' },
    invoice.version,
  )
  const account = (
    await db.query<{ id: string }>(
      "select id from accounts where bank_code='Santander'",
    )
  ).rows[0].id
  const before = await currentCash()
  await db.query("select command('pay_invoice',$1::jsonb,gen_random_uuid())", [
    JSON.stringify({
      id: invoice.id,
      account_id: account,
      amount_cents: 10000,
      paid_on: '2020-01-20',
    }),
  ])
  const payment = (
    await db.query<{ id: string; version: number }>(
      'select id,version from payments where invoice_id=$1 and reversed_at is null',
      [invoice.id],
    )
  ).rows[0]
  await edit(
    'payment',
    payment.id,
    {
      name: 'Pagamento corrigido',
      amount_cents: 12000,
      date: '2020-01-21',
      account_id: account,
    },
    payment.version,
  )
  expect(await currentCash()).toBe(before - 12000)
  expect(
    Number(
      (
        await db.query<{ paid_cents: number }>(
          'select paid_cents from invoices where id=$1',
          [invoice.id],
        )
      ).rows[0].paid_cents,
    ),
  ).toBe(12000)
  await expect(
    edit(
      'invoice',
      invoice.id,
      { name: 'Inválida', amount_cents: 100, date: '2030-01-02' },
      invoice.version + 2,
    ),
  ).rejects.toThrow()
})
it('entrada confirmada futura é editável e não vira saldo real antecipado', async () => {
  const source = (
    await db.query<{ id: string; version: number }>(
      "select id,version from financial_import_records where record_type='income_pending' order by id limit 1",
    )
  ).rows[0]
  const before = await currentCash()
  await edit(
    'income_estimate',
    source.id,
    { name: 'Entrada confirmada', amount_cents: 98765, date: '2099-11-30' },
    source.version,
  )
  expect(await currentCash()).toBe(before)
  const linked = (
    await db.query<{ linked_id: string; needs_review: boolean }>(
      'select linked_id,needs_review from financial_import_records where id=$1',
      [source.id],
    )
  ).rows[0]
  expect(linked.linked_id).toBeTruthy()
  expect(linked.needs_review).toBe(false)
  expect(
    (
      await db.query<{ status: string }>(
        'select status from transactions where id=$1',
        [linked.linked_id],
      )
    ).rows[0].status,
  ).toBe('confirmed')
})
it('agenda sessões PIX nas datas escolhidas, herda tags e não duplica ao reprocessar', async () => {
  const source = (
    await db.query<{ id: string; version: number }>(
      "select id,version from financial_import_records where source_key='psicologa_teste' order by id limit 1",
    )
  ).rows[0]
  const tag = (
    await db.query<{ result: { id: string } }>(
      "select command('save_tag',$1::jsonb,gen_random_uuid()) result",
      [JSON.stringify({ name: 'Saúde' })],
    )
  ).rows[0].result.id
  await manage('edit_imported_recurrence', {
    ...source,
    name: 'Psicóloga',
    amount_cents: 18000,
    active: true,
    tag_ids: [tag],
    dates: ['2030-11-05', '2030-11-19', '2030-12-03', '2030-12-17'],
  })
  await db.query('select schedule_imported_sessions($1,$2::date[])', [
    source.id,
    ['2030-11-05', '2030-11-19', '2030-12-03', '2030-12-17'],
  ])
  const sessions = await db.query<{
    payment_method: string
    tag_ids: string[]
    amount_cents: number
  }>(
    "select * from transactions where source_type='recurrence_session' order by occurred_on",
  )
  expect(sessions.rows).toHaveLength(4)
  expect(
    sessions.rows.every(
      (row) =>
        row.payment_method === 'pix' &&
        row.tag_ids.includes(tag) &&
        Number(row.amount_cents) === 18000,
    ),
  ).toBe(true)
  const before = await currentCash()
  await db.query("select prepare_financial_horizon('2030-11-01','2030-12-31')")
  await db.query("select prepare_financial_horizon('2030-11-01','2030-12-31')")
  expect(
    (
      await db.query(
        "select * from transactions where source_type='recurrence_session'",
      )
    ).rows,
  ).toHaveLength(4)
  expect(await currentCash()).toBe(before)
})
it('tags de recorrência padrão chegam às ocorrências, e tags de outro titular são negadas', async () => {
  const tag = (
    await db.query<{ id: string }>("select id from tags where name='Saúde'")
  ).rows[0].id
  const account = (
    await db.query<{ id: string }>(
      "select id from accounts where bank_code='Santander'",
    )
  ).rows[0].id
  const result = await db.query<{ result: { id: string } }>(
    "select command('save_recurrence',$1::jsonb,gen_random_uuid()) result",
    [
      JSON.stringify({
        description: 'Fixo com tag',
        kind: 'expense',
        amount_cents: 1234,
        account_id: account,
        day: 5,
        start_on: '2040-01-01',
        tag_ids: [tag],
      }),
    ],
  )
  await db.query("select prepare_financial_horizon('2040-01-01','2040-01-31')")
  const rows = await db.query<{ tag_ids: string[] }>(
    'select t.tag_ids from recurrence_occurrences o join transactions t on t.id=o.transaction_id where o.rule_id=$1',
    [result.rows[0].result.id],
  )
  expect(rows.rows[0].tag_ids).toContain(tag)
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other])
  await expect(
    db.query("select command('save_recurrence',$1::jsonb,gen_random_uuid())", [
      JSON.stringify({
        description: 'Inválido',
        kind: 'expense',
        amount_cents: 100,
        account_id: account,
        day: 5,
        start_on: '2040-01-01',
        tag_ids: [tag],
      }),
    ]),
  ).rejects.toThrow()
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner])
})
