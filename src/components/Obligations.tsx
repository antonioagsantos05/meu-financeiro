import type { Data } from '../domain/types'
import { obligations } from '../lib/ledger'
import { money, today } from '../lib/money'
export function Obligations({
  data,
  open,
}: {
  data: Data
  open: (type: string, item?: object) => void
}) {
  const rows = obligations(data)
  const date = (value: string) =>
    new Date(value + 'T12:00:00').toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Faturas e empréstimos</h2>
        <small>Por data de pagamento / vencimento</small>
      </div>
      {rows.map((row) => {
        if (row.type === 'loan') {
          const loan = row.loan
          return (
            <div className="list-row" key={'loan:' + loan.id}>
              <div>
                <strong>
                  {loan.related_bank_code || 'Nubank'} · Empréstimo
                </strong>
                <small>
                  {loan.status === 'confirmed' &&
                  (loan.paid_on || loan.occurred_on) <= today()
                    ? `Pago em ${date(loan.paid_on || loan.occurred_on)}`
                    : `Vence ${date(loan.occurred_on)}`}{' '}
                  · parcela separada da fatura
                </small>
                <small>Sai da conta Santander</small>
              </div>
              <b>{money(loan.amount_cents)}</b>
              <button
                className="secondary"
                onClick={() =>
                  open(
                    loan.status === 'confirmed' &&
                      (loan.paid_on || loan.occurred_on) <= today()
                      ? 'unconfirm_transaction'
                      : 'confirm_transaction',
                    loan,
                  )
                }
              >
                {loan.status === 'confirmed' &&
                (loan.paid_on || loan.occurred_on) <= today()
                  ? 'Desfazer'
                  : 'Pagar'}
              </button>
              <button
                className="secondary"
                onClick={() => open('transaction', loan)}
              >
                Editar
              </button>
            </div>
          )
        }
        const invoice = row.invoice,
          card = data.cards.find((c) => c.id === invoice.card_id)
        return (
          <div className="list-row" key={'invoice:' + invoice.id}>
            <div>
              <strong>
                {invoice.label || `${card?.name || 'Cartão'} · Fatura`}
              </strong>
              <small>
                Vence {date(invoice.due_on)} ·{' '}
                {invoice.status === 'paid'
                  ? 'Paga'
                  : invoice.status === 'partial'
                    ? 'Parcial'
                    : 'Aberta'}
              </small>
            </div>
            <span>
              {money(invoice.total_cents - invoice.paid_cents)}
              <small>Pago: {money(invoice.paid_cents)}</small>
            </span>
            {invoice.status !== 'paid' && (
              <button
                className="secondary"
                onClick={() => open('payment', invoice)}
              >
                Pagar
              </button>
            )}
            <button
              className="secondary"
              onClick={() =>
                open('event_edit', {
                  id: invoice.id,
                  original_id: invoice.id,
                  event_type: 'invoice',
                  description: invoice.label || 'Fatura ' + (card?.name || ''),
                  amount_cents: invoice.total_cents,
                  occurred_on: invoice.due_on,
                  version: invoice.version || 1,
                })
              }
            >
              Editar
            </button>
            {data.payments
              .filter((p) => p.invoice_id === invoice.id && !p.reversed_at)
              .map((p) => (
                <button
                  className="secondary"
                  key={p.id}
                  onClick={() =>
                    open('reverse_payment', {
                      id: p.id,
                      description: `Pagamento de ${money(p.amount_cents)} em ${date(p.paid_on)}`,
                    })
                  }
                >
                  Desfazer pagamento
                </button>
              ))}
          </div>
        )
      })}
      {!rows.length && (
        <p className="empty-inline">
          Nenhuma fatura ou parcela de empréstimo cadastrada.
        </p>
      )}
    </section>
  )
}
