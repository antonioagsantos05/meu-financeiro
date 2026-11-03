import type { Data } from '../domain/types'
import { fixedExpenses } from '../lib/fixedExpenses'
import { money } from '../lib/money'
export function FixedExpenses({
  data,
  from,
  until,
}: {
  data: Data
  from: string
  until: string
}) {
  const rows = fixedExpenses(data, from, until)
  const sum = (basis: string) =>
    rows
      .filter((r) => r.basis === basis)
      .reduce((total, row) => total + row.amount_cents, 0)
  return (
    <section className="panel">
      <div className="panel-title">
        <h2>Gastos fixos no período</h2>
      </div>
      <div className="fixed-totals">
        <div>
          <small>Recorrências e parcelas via conta</small>
          <strong>{money(sum('account'))}</strong>
        </div>
        <div>
          <small>Assinaturas no cartão</small>
          <strong>{money(sum('card_component'))}</strong>
        </div>
      </div>
      {rows.map((row) => (
        <div className="list-row" key={row.id}>
          <div>
            <strong>{row.name}</strong>
            <small>
              {new Date(row.date + 'T12:00:00').toLocaleDateString('pt-BR')} ·{' '}
              {row.basis === 'account'
                ? 'Conta Santander'
                : 'Componente da fatura'}
            </small>
            <div className="tags">
              {data.tags
                .filter((tag) => row.tag_ids.includes(tag.id))
                .map((tag) => (
                  <span key={tag.id}>{tag.name}</span>
                ))}
            </div>
          </div>
          <b>{money(row.amount_cents)}</b>
        </div>
      ))}
      {!rows.length && (
        <p className="empty-inline">
          Nenhum gasto fixo registrado neste período.
        </p>
      )}
      <p className="footnote">
        As assinaturas do cartão já compõem as faturas e não são somadas
        novamente às saídas de caixa. Sessões sem data definida não são
        incluídas.
      </p>
    </section>
  )
}
