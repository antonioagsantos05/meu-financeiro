import type { Data } from '../domain/types'
import { isLoan } from './ledger'
import { monthPeriod } from './dates'
export interface FixedExpense {
  id: string
  name: string
  amount_cents: number
  date: string
  basis: 'account' | 'card_component'
  tag_ids: string[]
}
export function fixedExpenses(
  data: Data,
  from: string,
  until: string,
): FixedExpense[] {
  const fixedTagIds = data.tags
    .filter((t) =>
      ['fixo', 'fixos', 'gastos fixos'].includes(
        t.name.trim().toLocaleLowerCase('pt-BR'),
      ),
    )
    .map((t) => t.id)
  const account: FixedExpense[] = data.transactions
    .filter(
      (t) =>
        (!t.deleted_at &&
          t.kind === 'expense' &&
          t.payment_method !== 'credit' &&
          ['recurrence', 'recurrence_session'].includes(t.source_type || '')) ||
        (!t.deleted_at && t.kind === 'expense' && isLoan(data, t)) ||
        (!t.deleted_at &&
          t.kind === 'expense' &&
          t.payment_method !== 'credit' &&
          t.tag_ids.some((id) => fixedTagIds.includes(id))),
    )
    .map((t) => ({
      id: t.id,
      name: t.description,
      amount_cents: t.amount_cents,
      date:
        t.status === 'confirmed' ? t.paid_on || t.occurred_on : t.occurred_on,
      basis: 'account',
      tag_ids: t.tag_ids,
    }))
  const subscriptions = [
    ...new Map(
      data.financial_import_records
        .filter(
          (r) =>
            r.record_type === 'recurrence' &&
            r.payload.tipo === 'assinatura_cartao',
        )
        .map((r) => [r.source_key, r]),
    ).values(),
  ]
  const card: FixedExpense[] = []
  let month = monthPeriod(from).start
  for (let i = 0; month <= until && i < 25; i++) {
    const period = monthPeriod(month)
    for (const source of subscriptions) {
      if (source.payload.status === 'pausada') continue
      const day = Number(source.payload.dia_mes)
      if (!Number.isInteger(day) || day < 1 || day > 31) continue
      const date =
        month.slice(0, 8) +
        String(Math.min(day, Number(period.end.slice(8)))).padStart(2, '0')
      if (source.payload.end_on && date > String(source.payload.end_on))
        continue
      card.push({
        id: source.id + ':' + month,
        name: String(source.payload.descricao),
        amount_cents: Number(source.payload.valor_centavos),
        date,
        basis: 'card_component',
        tag_ids: (source.payload.tag_ids as string[]) || [],
      })
    }
    month = monthPeriod(month, 1).start
  }
  return [...account, ...card]
    .filter((row) => row.date >= from && row.date <= until)
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name),
    )
}
