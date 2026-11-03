import { expect, it } from 'vitest'
import { emptyData } from '../domain/types'
import type { Data, Transaction } from '../domain/types'
import { fixedExpenses } from '../lib/fixedExpenses'
const session: Transaction = {
  id: 'session',
  kind: 'expense',
  description: 'Psicóloga',
  amount_cents: 18000,
  occurred_on: '2026-12-03',
  status: 'scheduled',
  payment_method: 'pix',
  account_id: 'cash',
  card_id: null,
  destination_account_id: null,
  version: 1,
  deleted_at: null,
  tag_ids: ['health'],
  source_type: 'recurrence_session',
}
it('separa sessões/parcelas da conta de assinaturas componentes de fatura', () => {
  const data: Data = {
    ...emptyData,
    transactions: [
      session,
      {
        ...session,
        id: 'loan',
        description: 'Parcela empréstimo',
        amount_cents: 68800,
        source_type: 'import_commitment',
        tag_ids: [],
      },
      {
        ...session,
        id: 'dentist',
        description: 'Dentista',
        amount_cents: 41700,
        source_type: 'import_commitment',
      },
    ],
    financial_import_records: [
      {
        id: 'subscription',
        record_type: 'recurrence',
        source_key: 'service',
        payload: {
          tipo: 'assinatura_cartao',
          descricao: 'Serviço',
          valor_centavos: 1990,
          dia_mes: 4,
          status: 'ativa',
          tag_ids: ['leisure'],
        },
        needs_review: false,
        review_reason: null,
        linked_id: null,
      },
    ],
  }
  const rows = fixedExpenses(data, '2026-12-01', '2026-12-31')
  expect(
    rows
      .filter((row) => row.basis === 'account')
      .reduce((s, r) => s + r.amount_cents, 0),
  ).toBe(86800)
  expect(
    rows
      .filter((row) => row.basis === 'card_component')
      .reduce((s, r) => s + r.amount_cents, 0),
  ).toBe(1990)
  expect(rows.find((row) => row.id === 'session')?.tag_ids).toContain('health')
  expect(rows.find((row) => row.id === 'dentist')).toBeUndefined()
})
