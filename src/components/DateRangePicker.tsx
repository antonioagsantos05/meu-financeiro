import { monthPeriod } from '../lib/dates'
import { useState } from 'react'
import { ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react'
export function DateRangePicker({
  from,
  until,
  onChange,
}: {
  from: string
  until: string
  onChange: (from: string, until: string) => void
}) {
  const [custom, setCustom] = useState(false)
  function navigate(offset: number) {
    const range = monthPeriod(from, offset)
    onChange(range.start, range.end)
  }
  return (
    <div className="date-range-picker">
      <div className="period-toolbar">
        <div className="period-month">
          <button
            type="button"
            aria-label="Mês anterior"
            onClick={() => navigate(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <input
            aria-label="Selecionar mês do período"
            type="month"
            value={from.slice(0, 7)}
            onChange={(e) => {
              if (e.target.value) {
                const range = monthPeriod(e.target.value + '-01')
                onChange(range.start, range.end)
              }
            }}
          />
          <button
            type="button"
            aria-label="Próximo mês"
            onClick={() => navigate(1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          className="period-custom"
          type="button"
          aria-expanded={custom}
          onClick={() => setCustom(!custom)}
        >
          <SlidersHorizontal size={14} />
          Período personalizado
        </button>
      </div>
      {custom && (
        <div className="date-boundaries">
          <label>
            De
            <input
              aria-label="Data inicial do período"
              type="date"
              value={from}
              onChange={(e) => {
                if (e.target.value)
                  onChange(
                    e.target.value,
                    e.target.value > until ? e.target.value : until,
                  )
              }}
            />
          </label>
          <label>
            Até
            <input
              aria-label="Data final do período"
              type="date"
              value={until}
              onChange={(e) => {
                if (e.target.value)
                  onChange(
                    e.target.value < from ? e.target.value : from,
                    e.target.value,
                  )
              }}
            />
          </label>
        </div>
      )}
    </div>
  )
}
