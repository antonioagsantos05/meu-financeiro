import { expect, it } from 'vitest'
import { emptyData } from '../domain/types'
import type { Data, Transaction } from '../domain/types'
import { cashReport, movementEvents, obligations } from '../lib/ledger'
const purchase: Transaction = {
  id: 'purchase',
  kind: 'expense',
  description: 'Compra',
  amount_cents: 60000,
  occurred_on: '2026-11-01',
  status: 'confirmed',
  payment_method: 'credit',
  card_id: 'card',
  account_id: null,
  destination_account_id: null,
  version: 1,
  deleted_at: null,
  tag_ids: ['food', 'family'],
}
const data: Data = {
  ...emptyData,
  accounts: [
    {
      id: 'cash',
      name: 'Santander',
      bank_code: 'Santander',
      opening_balance_cents: 0,
      overdraft_limit_cents: 0,
      active: true,
      version: 1,
    },
  ],
  cards: [
    {
      id: 'card',
      name: 'Nubank',
      account_id: 'cash',
      closing_day: 10,
      due_day: 15,
    },
  ],
  transactions: [
    purchase,
    {
      ...purchase,
      id: 'pix',
      description: 'Almoço',
      amount_cents: 2500,
      payment_method: 'pix',
      account_id: 'cash',
      card_id: null,
    },
  ],
  invoices: [
    {
      id: 'invoice',
      card_id: 'card',
      due_on: '2026-11-15',
      status: 'partial',
      total_cents: 60000,
      paid_cents: 20000,
    },
  ],
  payments: [
    {
      id: 'pay',
      kind: 'invoice',
      account_id: 'cash',
      invoice_id: 'invoice',
      amount_cents: 20000,
      paid_on: '2026-11-03',
    },
    {
      id: 'reversed',
      account_id: 'cash',
      invoice_id: 'invoice',
      amount_cents: 1000,
      paid_on: '2026-11-03',
      reversed_at: '2026-11-03T12:00:00Z',
    },
  ],
}
it('Movimentos reúne compras, pagamentos e faturas abertas; relatório não duplica cartão', () => {
  const events = movementEvents(data)
  expect(events.find((e) => e.id === 'payment:pay')?.status).toBe('confirmed')
  expect(events.find((e) => e.id === 'payment:reversed')).toBeUndefined()
  const report = cashReport(events, '2026-11-01', '2026-11-30', '2026-11-03')
  expect(report.expense).toBe(22500)
  expect(report.plannedExpense).toBe(40000)
  expect(report.realized.find((e) => e.id === 'purchase')).toBeUndefined()
})
it('entradas importadas não aumentam realizado e filtros de período continuam funcionando', () => {
  const inputs = {
    ...data,
    financial_import_records: [
      {
        id: 'source',
        source_key: 'salary',
        record_type: 'income_pending',
        needs_review: true,
        linked_id: null,
        review_reason: null,
        payload: {
          descricao: 'Salário',
          valor_centavos: 100000,
          data: '2026-11-30',
        },
      },
    ],
  }
  const report = cashReport(
    movementEvents(inputs),
    '2026-11-01',
    '2026-11-30',
    '2026-11-03',
  )
  expect(report.plannedIncome).toBe(100000)
  expect(report.income).toBe(0)
  expect(
    cashReport(movementEvents(inputs), '2026-12-01', '2026-12-31', '2026-11-03')
      .expense,
  ).toBe(0)
})
it('ordena pela data efetiva de pagamento e recebimento, não pela inserção', () => {
  const sample: Data = {
    ...emptyData,
    transactions: [
      {
        ...purchase,
        id: 'first-created',
        payment_method: 'pix',
        occurred_on: '2026-11-01',
        paid_on: '2026-11-20',
      },
      {
        ...purchase,
        id: 'last-created',
        payment_method: 'pix',
        occurred_on: '2026-11-10',
        paid_on: '2026-11-03',
      },
      {
        ...purchase,
        id: 'scheduled',
        payment_method: 'pix',
        status: 'scheduled',
        occurred_on: '2026-11-15',
      },
    ],
  }
  expect(movementEvents(sample).map((row) => row.id)).toEqual([
    'last-created',
    'scheduled',
    'first-created',
  ])
})
it('inclui empréstimo Nubank entre as faturas, sem incorporá-lo ao valor da fatura', () => {
  const loan: Transaction = {
    ...purchase,
    id: 'loan',
    description: 'Parcela empréstimo',
    related_bank_code: 'Nubank',
    source_type: 'import_commitment',
    payment_method: 'pix',
    card_id: null,
    account_id: 'cash',
    status: 'scheduled',
    amount_cents: 68800,
    occurred_on: '2026-11-10',
  }
  const sample = { ...data, transactions: [...data.transactions, loan] }
  expect(obligations(sample).map((row) => row.type)).toEqual([
    'loan',
    'invoice',
  ])
  expect(
    obligations(sample).find((row) => row.type === 'invoice')?.invoice
      .total_cents,
  ).toBe(60000)
  expect(
    cashReport(movementEvents(sample), '2026-11-01', '2026-11-30', '2026-11-03')
      .plannedExpense,
  ).toBe(108800)
})
