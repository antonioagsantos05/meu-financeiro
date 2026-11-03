import { useState } from 'react'
import type { Transaction } from '../domain/types'
import { money, today } from '../lib/money'
interface Row {
  day: string
  real_cents: number
  projected_cents: number
}
export function ForecastCalendar({
  rows,
  events,
  onNewMovement,
}: {
  rows: Row[]
  events: Transaction[]
  onNewMovement?: (day: string) => void
}) {
  const [monthIndex, setMonthIndex] = useState(0),
    [selected, setSelected] = useState(today())
  const months = [...new Set(rows.map((row) => row.day.slice(0, 7)))]
  const month = months[Math.min(monthIndex, months.length - 1)]
  if (!month) return null
  const first = new Date(month + '-01T12:00:00Z'),
    offset = (first.getUTCDay() + 6) % 7
  const days = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate()
  const selectedRow = rows.find((r) => r.day === selected)
  const dailyEvents = events.filter(
    (e) => e.occurred_on === selected && e.status !== 'reversed',
  )
  return (
    <div className="forecast-planner">
      <div className="calendar-toolbar">
        <button
          className="secondary"
          aria-label="Mês anterior"
          disabled={monthIndex === 0}
          onClick={() => {
            setMonthIndex((i) => i - 1)
            setSelected(
              rows.find((r) => r.day.startsWith(months[monthIndex - 1]))!.day,
            )
          }}
        >
          ←
        </button>
        <label className="calendar-month-select">
          Mês
          <select
            aria-label="Mês da projeção"
            value={month}
            onChange={(e) => {
              setMonthIndex(months.indexOf(e.target.value))
              setSelected(
                rows.find((r) => r.day.startsWith(e.target.value))!.day,
              )
            }}
          >
            {months.map((value) => (
              <option key={value} value={value}>
                {new Date(value + '-01T12:00:00Z').toLocaleDateString('pt-BR', {
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                })}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          aria-label="Próximo mês"
          disabled={monthIndex >= months.length - 1}
          onClick={() => {
            setMonthIndex((i) => i + 1)
            setSelected(
              rows.find((r) => r.day.startsWith(months[monthIndex + 1]))!.day,
            )
          }}
        >
          →
        </button>
      </div>
      <button
        className="text-button"
        onClick={() => {
          setMonthIndex(Math.max(0, months.indexOf(today().slice(0, 7))))
          setSelected(today())
        }}
      >
        Voltar para hoje
      </button>
      <p className="calendar-hint">
        Selecione um dia para ver os movimentos e o saldo previsto.
      </p>
      <div className="planner-columns">
        <div className="planner-grid">
          {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((day) => (
            <span className="weekday" key={day}>
              {day}
            </span>
          ))}
          {Array.from({ length: offset }, (_, i) => (
            <span key={'blank' + i} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const day = month + '-' + String(i + 1).padStart(2, '0'),
              row = rows.find((r) => r.day === day),
              items = events.filter(
                (e) => e.occurred_on === day && e.status !== 'reversed',
              )
            return (
              <button
                disabled={!row}
                key={day}
                className={`planner-cell ${selected === day ? 'selected' : ''} ${day === today() ? 'is-today' : ''}`}
                onClick={() => setSelected(day)}
                aria-label={`${i + 1} ${first.toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' })}${row ? ', saldo previsto ' + money(row.projected_cents) : ''}`}
              >
                <span>{i + 1}</span>
                {row && (
                  <strong
                    className={
                      row.projected_cents < 0 ? 'negative' : 'positive'
                    }
                  >
                    {money(row.projected_cents)}
                  </strong>
                )}
                {items.length > 0 && (
                  <small>
                    {items.length} movimento{items.length > 1 ? 's' : ''}
                  </small>
                )}
              </button>
            )
          })}
        </div>
        <section className="day-agenda">
          <span className="eyebrow">
            {new Date(selected + 'T12:00:00').toLocaleDateString('pt-BR', {
              day: 'numeric',
              month: 'long',
            })}
          </span>
          <h3
            className={
              selectedRow && selectedRow.projected_cents < 0
                ? 'negative'
                : 'positive'
            }
          >
            {selectedRow
              ? money(selectedRow.projected_cents)
              : 'Selecione um dia'}
          </h3>
          <small>Saldo previsto ao final do dia</small>
          {onNewMovement && selectedRow && (
            <button
              className="secondary"
              onClick={() => onNewMovement(selected)}
            >
              Adicionar movimento nesta data
            </button>
          )}
          {dailyEvents.map((e) => (
            <div className="agenda-item" key={e.id}>
              <div>
                <strong>{e.description}</strong>
                <small>
                  {e.status === 'confirmed' && e.occurred_on <= today()
                    ? 'Realizado'
                    : e.status === 'estimated'
                      ? 'Estimado'
                      : 'Agendado'}
                  {e.payment_method === 'credit'
                    ? ' · compra no cartão, sem baixa na conta'
                    : ''}
                </small>
              </div>
              <span className={e.kind === 'income' ? 'positive' : ''}>
                {e.kind === 'income' ? '+' : '−'} {money(e.amount_cents)}
              </span>
            </div>
          ))}
          {!dailyEvents.length && (
            <p className="footnote">Nenhum movimento neste dia.</p>
          )}
          <p className="footnote">
            Valores previstos podem mudar. Datas provisórias e despesas ainda
            sem data precisam de confirmação.
          </p>
        </section>
      </div>
    </div>
  )
}
