import type { Data, Transaction } from '../domain/types'
export function movementEvents(data: Data): Transaction[] {
  const movements = data.transactions
    .filter((t) => !t.deleted_at)
    .map((t) => ({
      ...t,
      event_type: 'transaction' as const,
      occurred_on:
        t.status === 'confirmed' ? t.paid_on || t.occurred_on : t.occurred_on,
    }))
  const payments = data.payments
    .filter((p) => !p.reversed_at)
    .map((p) => ({
      id: 'payment:' + p.id,
      original_id: p.id,
      event_type: 'payment' as const,
      description:
        p.label ||
        `Pagamento ${p.invoice_id ? 'fatura ' + (data.cards.find((c) => c.id === data.invoices.find((i) => i.id === p.invoice_id)?.card_id)?.name || '') : 'quitação'}`,
      kind: 'expense',
      amount_cents: p.amount_cents,
      occurred_on: p.paid_on,
      status: p.reversed_at ? 'reversed' : 'confirmed',
      payment_method: 'invoice_payment',
      account_id: p.account_id,
      destination_account_id: null,
      card_id:
        data.invoices.find((i) => i.id === p.invoice_id)?.card_id || null,
      version: p.version || 1,
      deleted_at: null,
      tag_ids: [],
    }))
  const invoices = data.invoices
    .filter((i) => i.total_cents > i.paid_cents)
    .map((i) => ({
      id: 'invoice:' + i.id,
      original_id: i.id,
      event_type: 'invoice' as const,
      description:
        i.label ||
        'Fatura ' + (data.cards.find((c) => c.id === i.card_id)?.name || ''),
      kind: 'expense',
      amount_cents: i.total_cents - i.paid_cents,
      occurred_on: i.due_on,
      status: 'scheduled',
      payment_method: 'invoice_payment',
      account_id:
        data.cards.find((c) => c.id === i.card_id)?.account_id || null,
      destination_account_id: null,
      card_id: i.card_id,
      version: i.version || 1,
      deleted_at: null,
      tag_ids: [],
    }))
  const imported = [
    ...new Map(
      data.financial_import_records
        .filter(
          (r) =>
            r.record_type === 'income_pending' &&
            !r.linked_id &&
            r.payload.data,
        )
        .map((r) => [r.source_key + ':' + r.payload.data, r]),
    ).values(),
  ]
  const incomeEstimates: Transaction[] = imported
    .filter(
      (r) =>
        !movements.some(
          (t) =>
            t.kind === 'income' &&
            t.occurred_on === r.payload.data &&
            t.amount_cents === Number(r.payload.valor_centavos),
        ),
    )
    .map((r) => ({
      id: 'estimate:' + r.id,
      original_id: r.id,
      event_type: 'income_estimate',
      description: String(r.payload.descricao),
      kind: 'income',
      amount_cents: Number(r.payload.valor_centavos),
      occurred_on: String(r.payload.data),
      status: 'estimated',
      payment_method: 'pix',
      account_id:
        data.accounts.find((a) => a.bank_code === 'Santander')?.id || null,
      destination_account_id: null,
      card_id: null,
      version: r.version || 1,
      deleted_at: null,
      tag_ids: [],
    }))
  return [...movements, ...payments, ...invoices, ...incomeEstimates].sort(
    (a, b) =>
      a.occurred_on.localeCompare(b.occurred_on) || a.id.localeCompare(b.id),
  )
}
export function isLoan(data: Data, transaction: Transaction) {
  return (
    !transaction.deleted_at &&
    (data.financial_import_records.some(
      (record) =>
        record.record_type === 'commitment' &&
        record.linked_id === transaction.id &&
        record.payload.tipo === 'emprestimo',
    ) ||
      (transaction.source_type === 'import_commitment' &&
        transaction.description
          .toLocaleLowerCase('pt-BR')
          .includes('empréstimo')))
  )
}
export function obligations(data: Data) {
  const invoiceRows = data.invoices
    .filter((i) => i.total_cents > 0)
    .map((invoice) => ({
      id: invoice.id,
      type: 'invoice' as const,
      date: invoice.due_on,
      invoice,
    }))
  const loanRows = data.transactions
    .filter((t) => isLoan(data, t))
    .map((loan) => ({
      id: loan.id,
      type: 'loan' as const,
      date:
        loan.status === 'confirmed'
          ? loan.paid_on || loan.occurred_on
          : loan.occurred_on,
      loan,
    }))
  return [...invoiceRows, ...loanRows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  )
}
export function cashReport(
  events: Transaction[],
  start: string,
  end: string,
  reference: string,
) {
  const period = events.filter(
    (e) =>
      e.occurred_on >= start &&
      e.occurred_on <= end &&
      e.kind !== 'transfer' &&
      e.payment_method !== 'credit' &&
      e.status !== 'reversed',
  )
  const realized = period.filter(
    (e) => e.status === 'confirmed' && e.occurred_on <= reference,
  )
  const planned = period.filter(
    (e) => e.status !== 'confirmed' || e.occurred_on > reference,
  )
  const sum = (items: Transaction[], kind: string) =>
    items.filter((e) => e.kind === kind).reduce((s, e) => s + e.amount_cents, 0)
  return {
    period,
    realized,
    planned,
    income: sum(realized, 'income'),
    expense: sum(realized, 'expense'),
    plannedIncome: sum(planned, 'income'),
    plannedExpense: sum(planned, 'expense'),
  }
}
