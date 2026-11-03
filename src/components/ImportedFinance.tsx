import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { money } from '../lib/money'
import { TagPicker } from './TagPicker'
import type { Tag } from '../domain/types'

interface ImportedRecord {
  id: string
  record_type: string
  source_key: string
  payload: Record<string, unknown>
  needs_review: boolean
  review_reason: string | null
  linked_id: string | null
  version?: number
}
export function ImportedFinance({
  mode = 'all',
  onChanged,
  tags = [],
  createTag,
}: {
  mode?: 'all' | 'recurrences' | 'forecast'
  onChanged?: () => Promise<void>
  tags?: Tag[]
  createTag?: (name: string) => Promise<Tag>
}) {
  const [rows, setRows] = useState<ImportedRecord[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<ImportedRecord | null>(null)
  const [saving, setSaving] = useState(false)
  const [reload, setReload] = useState(0)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [dateCount, setDateCount] = useState(2)
  async function saveEdit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!editing || !supabase) return
    const f = new FormData(e.currentTarget)
    setSaving(true)
    setError('')
    try {
      const text = String(f.get('amount')).replace(/\./g, '').replace(',', '.')
      if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Valor inválido')
      const { error } = await supabase.rpc('manage_finance', {
        action: 'edit_imported_recurrence',
        request_key: crypto.randomUUID(),
        payload: {
          id: editing.id,
          version: editing.version || 1,
          name: String(f.get('name')),
          amount_cents: Math.round(Number(text) * 100),
          day: f.get('day'),
          second_day: f.get('second_day'),
          active: f.has('active'),
          tag_ids: selectedTags,
          end_on: f.get('end_on'),
          ...(editing.payload.tipo === 'despesa' &&
          editing.payload.frequencia === '2_por_mes_aprox_15_dias'
            ? { dates: f.getAll('session_dates').filter(Boolean) }
            : {}),
        },
      })
      if (error) throw error
      setEditing(null)
      setReload((n) => n + 1)
      await onChanged?.()
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : typeof e === 'object' && e && 'message' in e
            ? String(e.message)
            : 'Não foi possível salvar',
      )
    } finally {
      setSaving(false)
    }
  }
  useEffect(() => {
    let active = true
    if (!supabase) return
    void supabase
      .from('financial_import_records')
      .select('*')
      .order('record_type')
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          if (error.code !== 'PGRST205' && error.code !== '42P01')
            setError(error.message)
          return
        }
        setRows(data)
      })
    return () => {
      active = false
    }
  }, [reload])
  if (!rows.length) return null
  const metadata = rows.find((row) => row.record_type === 'metadata')?.payload
  if (mode === 'forecast') {
    const incomes = [
      ...new Map(
        rows
          .filter(
            (row) => row.record_type === 'income_pending' && !row.linked_id,
          )
          .map((row) => [`${row.source_key}:${row.payload.data}`, row]),
      ).values(),
    ]
    if (!incomes.length) return null
    return (
      <section className="panel">
        <div className="panel-title">
          <h2>Entradas previstas</h2>
          <strong className="positive">
            +{' '}
            {money(
              incomes.reduce(
                (sum, row) => sum + Number(row.payload.valor_centavos || 0),
                0,
              ),
            )}
          </strong>
        </div>
        {incomes.map((row) => (
          <div className="list-row" key={row.id}>
            <div>
              <strong>{String(row.payload.descricao || row.source_key)}</strong>
              <small>
                {typeof row.payload.data === 'string'
                  ? new Date(row.payload.data + 'T12:00:00').toLocaleDateString(
                      'pt-BR',
                    )
                  : 'Sem data'}{' '}
                · data provisória ·{' '}
                {row.payload.status === 'estimado'
                  ? 'valor estimado'
                  : 'recebimento previsto'}
              </small>
            </div>
            <b className="positive">
              + {money(Number(row.payload.valor_centavos))}
            </b>
          </div>
        ))}
        <p className="footnote">
          A projeção usa a data provisória informada no pacote. Estas entradas
          ainda não aumentam o saldo real. O salário de dezembro continua fora
          deste cenário.
        </p>
      </section>
    )
  }
  const selected = rows.filter((row) =>
    mode === 'recurrences'
      ? row.record_type === 'recurrence'
      : row.record_type !== 'metadata',
  )
  const summary = metadata?.projecao_resumo_centavos as
    Record<string, number> | undefined
  return (
    <section className="panel">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="panel-title">
        <h2>
          {mode === 'recurrences'
            ? 'Recorrências e assinaturas importadas'
            : 'Dados do pacote importado'}
        </h2>
      </div>
      <p className="footnote">
        Faturas agregadas entram no caixa uma única vez, pelo pagamento.
        Assinaturas já componentes dessas faturas não geram despesas bancárias
        adicionais. Informações sem dia confirmado não entram no calendário
        automaticamente.
      </p>
      {editing && (
        <form className="settings-panel" onSubmit={saveEdit} key={editing.id}>
          <h3>Editar recorrência</h3>
          <label className="field">
            Nome
            <input
              name="name"
              required
              defaultValue={String(editing.payload.descricao)}
            />
          </label>
          <label className="field">
            Valor (R$)
            <input
              name="amount"
              required
              defaultValue={(Number(editing.payload.valor_centavos) / 100)
                .toFixed(2)
                .replace('.', ',')}
            />
          </label>
          {editing.payload.frequencia === '2_por_mes_aprox_15_dias' ? (
            <>
              <h3>Datas das sessões</h3>
              <div className="form-grid">
                {Array.from({ length: dateCount }, (_, i) => (
                  <label className="field" key={i}>
                    Sessão {i + 1}
                    <input
                      type="date"
                      name="session_dates"
                      defaultValue={String(
                        ((editing.payload.confirmed_dates as string[]) || [])[
                          i
                        ] || '',
                      )}
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => setDateCount((n) => n + 1)}
              >
                Adicionar sessão
              </button>
            </>
          ) : (
            <div className="form-grid">
              <label className="field">
                Dia do mês (opcional)
                <input
                  name="day"
                  type="number"
                  min={1}
                  max={31}
                  defaultValue={String(editing.payload.dia_mes || '')}
                />
              </label>
              <label className="field">
                Segundo dia (opcional)
                <input
                  name="second_day"
                  type="number"
                  min={1}
                  max={31}
                  defaultValue={String(editing.payload.segundo_dia || '')}
                />
              </label>
            </div>
          )}
          <label className="field">
            Encerrar recorrência em (opcional)
            <input
              type="date"
              name="end_on"
              defaultValue={String(editing.payload.end_on || '')}
            />
          </label>
          {createTag && (
            <TagPicker
              tags={tags}
              selected={selectedTags}
              onChange={setSelectedTags}
              onCreate={createTag}
            />
          )}
          <label className="check">
            <input
              type="checkbox"
              name="active"
              defaultChecked={editing.payload.status !== 'pausada'}
            />
            Ativa
          </label>
          <p className="footnote">
            Mudanças valem para próximas ocorrências. Assinaturas já incluídas
            nas faturas não criam saída bancária extra.
          </p>
          <button className="primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={saving}
            onClick={() => setEditing(null)}
          >
            Cancelar
          </button>
        </form>
      )}
      {selected.map((row) => (
        <div className="list-row" key={row.id}>
          <div>
            <strong>
              {String(
                row.payload.descricao || row.payload.nome || row.source_key,
              )}
            </strong>
            <small>
              {row.needs_review
                ? 'A confirmar'
                : row.linked_id
                  ? 'Vinculado ao cadastro'
                  : 'Componente de fatura'}
            </small>
            <small>{row.review_reason}</small>
            {typeof row.payload.observacao === 'string' &&
              row.payload.observacao && <small>{row.payload.observacao}</small>}
          </div>
          {typeof row.payload.valor_centavos === 'number' && (
            <b>{money(row.payload.valor_centavos)}</b>
          )}
          {row.record_type === 'recurrence' && (
            <button
              className="secondary"
              disabled={saving}
              onClick={() => {
                setEditing(row)
                setSelectedTags((row.payload.tag_ids as string[]) || [])
                setDateCount(
                  Math.max(
                    2,
                    ((row.payload.confirmed_dates as string[]) || []).length,
                  ),
                )
                setError('')
              }}
            >
              Editar
            </button>
          )}
        </div>
      ))}
      {mode !== 'recurrences' && summary && (
        <div className="settings-panel">
          <h3>Cenário de referência do pacote</h3>
          <p className="footnote">
            Este cenário ilustrativo inclui salário de novembro e 13º estimado,
            exclui salário de dezembro, considera psicóloga sem dias definidos e
            acréscimo provisório de assinaturas. Não é saldo real nem equivale
            ao calendário operacional. Juros/IOF não incluídos.
          </p>
          <p>Despesas de dezembro: {money(summary.dezembro_despesas)}</p>
          <p>
            Saldo residual ilustrativo:{' '}
            {money(summary.dezembro_sobra_sem_salario_dezembro)}
          </p>
        </div>
      )}
    </section>
  )
}
