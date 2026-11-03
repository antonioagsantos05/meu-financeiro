import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Modal } from '../App'
import type { Data, Tag } from '../domain/types'
import { cents, today } from '../lib/money'
const raw = (v: unknown) => (Number(v || 0) / 100).toFixed(2).replace('.', ',')
const field = (name: string, node: ReactNode) => (
  <label className="field">
    <span>{name}</span>
    {node}
  </label>
)
export function Editor({
  modal,
  data,
  busy,
  error,
  close,
  save,
  createTag,
}: {
  modal: Modal
  data: Data
  busy: boolean
  error: string
  close: () => void
  save: (op: string, payload: Record<string, unknown>) => Promise<void>
  createTag: (name: string) => Promise<Tag>
}) {
  const { type, item } = modal
  const cashAccounts = data.accounts.filter(
    (account) => account.bank_code === 'Santander' && account.active,
  )
  const [kind, setKind] = useState(String(item?.kind || 'expense')),
    [method, setMethod] = useState(String(item?.payment_method || 'pix')),
    [validation, setValidation] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const [tagName, setTagName] = useState('')
  const [tagBusy, setTagBusy] = useState(false)
  const [addedTags, setAddedTags] = useState<Tag[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>(
    (item?.tag_ids as string[]) || [],
  )
  const [movementDate, setMovementDate] = useState(
    String(item?.occurred_on || today()),
  )
  const allTags = [
    ...data.tags,
    ...addedTags.filter(
      (tag) => !data.tags.some((existing) => existing.id === tag.id),
    ),
  ]
  async function addTag() {
    const name = tagName.trim()
    if (!name || tagBusy) return
    setValidation('')
    setTagBusy(true)
    try {
      const existing = allTags.find(
        (tag) =>
          tag.name.trim().toLocaleLowerCase('pt-BR') ===
          name.toLocaleLowerCase('pt-BR'),
      )
      const tag = existing || (await createTag(name))
      if (!existing) setAddedTags((tags) => [...tags, tag])
      setSelectedTags((tags) =>
        tags.includes(tag.id) ? tags : [...tags, tag.id],
      )
      setTagName('')
    } catch (e) {
      setValidation(
        e instanceof Error ? e.message : 'Não foi possível criar a tag.',
      )
    } finally {
      setTagBusy(false)
    }
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement
    ref.current?.querySelector<HTMLElement>('input,select,button')?.focus()
    function keyboard(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) close()
      if (e.key === 'Tab') {
        const elements = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
          ) || [],
        )
        const first = elements[0],
          last = elements.at(-1)
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last?.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => {
      document.removeEventListener('keydown', keyboard)
      previous?.focus()
    }
  }, [busy, close])
  const accounts = (name = 'account_id', value?: unknown) => (
    <select
      name={name}
      defaultValue={String(
        value || (cashAccounts.length === 1 ? cashAccounts[0].id : ''),
      )}
      required
    >
      <option value="">
        {cashAccounts.length
          ? 'Selecione a conta Santander'
          : 'Cadastre sua conta Santander'}
      </option>
      {cashAccounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  )
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setValidation('')
    try {
      const f = new FormData(e.currentTarget),
        v = Object.fromEntries(f.entries())
      let op = '',
        p: Record<string, unknown> = {
          ...v,
          id: item?.id,
          version: item?.version,
        }
      if (type === 'transaction') {
        op = item?.id ? 'edit_financial_event' : 'create_transaction'
        const m =
          kind === 'transfer' ? 'transfer' : kind === 'income' ? 'pix' : method
        p = {
          ...p,
          amount_cents: cents(String(v.amount)),
          payment_method: m,
          account_id: m === 'credit' ? null : v.account_id,
          card_id: m === 'credit' ? v.card_id : null,
          destination_account_id:
            kind === 'transfer' ? v.destination_account_id : null,
          tag_ids: selectedTags,
          installment_count: Number(v.installment_count || 1),
          status: 'confirmed',
        }
        if (item?.id)
          p = {
            ...p,
            entity: 'transaction',
            name: v.description,
            date: v.occurred_on,
          }
      } else if (type === 'event_edit') {
        op = 'edit_financial_event'
        p = {
          ...p,
          id: item?.original_id || item?.id,
          entity: item?.event_type,
          name: v.name,
          amount_cents: cents(String(v.amount)),
          date: v.date,
          account_id: v.account_id,
        }
      } else if (type === 'account') {
        op = 'save_account'
        const value = String(v.opening_balance)
        p = {
          ...p,
          opening_balance_cents: value.startsWith('-')
            ? -cents(value.slice(1))
            : cents(value),
          overdraft_limit_cents: cents(String(v.overdraft_limit)),
        }
      } else if (type === 'card') {
        op = 'save_card'
        p = {
          ...p,
          closing_day: Number(v.closing_day),
          due_day: Number(v.due_day),
        }
      } else if (type === 'tag') op = 'save_tag'
      else if (type === 'recurrence') {
        op = 'save_recurrence'
        p = {
          ...p,
          amount_cents: cents(String(v.amount)),
          day: Number(v.day),
          tag_ids: selectedTags,
          active: f.has('active'),
        }
      } else if (type === 'reminder') {
        op = 'save_reminder'
        const weekdays = f.getAll('weekdays').map(Number)
        if (!weekdays.length) throw Error('Selecione ao menos um dia.')
        p = { ...p, weekdays, enabled: f.has('enabled') }
      } else if (type === 'payment' || type === 'settlement') {
        op = type === 'payment' ? 'pay_invoice' : 'settle_installment_plan'
        p = {
          ...p,
          amount_cents: cents(String(v.amount)),
          issuer_confirmed: f.has('issuer_confirmed'),
        }
      } else if (type === 'delete') op = 'delete_transaction'
      else if (
        [
          'reverse_payment',
          'confirm_transaction',
          'unconfirm_transaction',
        ].includes(type)
      )
        op = type
      await save(op, p)
    } catch (e) {
      setValidation(e instanceof Error ? e.message : 'Dados inválidos.')
    }
  }
  const titles: Record<string, string> = {
    transaction: item?.id ? 'Editar movimento' : 'Novo movimento',
    account: 'Conta bancária',
    card: 'Adicionar cartão',
    tag: 'Tag',
    recurrence: 'Recorrência mensal',
    reminder: 'Lembrete',
    payment: 'Pagar fatura',
    settlement: 'Quitação antecipada',
    delete: 'Excluir movimento',
    event_edit: 'Editar movimento',
    reverse_payment: 'Desfazer pagamento',
    confirm_transaction:
      kind === 'income' ? 'Confirmar recebimento' : 'Confirmar pagamento',
    unconfirm_transaction: 'Desfazer confirmação',
  }
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) close()
      }}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-title">
          <div>
            <span className="eyebrow">MEU FINANCEIRO</span>
            <h2 id="modal-title">{titles[type]}</h2>
          </div>
          <button
            className="icon-button"
            disabled={busy}
            onClick={close}
            aria-label="Fechar"
          >
            <X />
          </button>
        </div>
        <form onSubmit={submit}>
          {type === 'transaction' && (
            <>
              {field(
                'Tipo',
                <select
                  name="kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  <option value="expense">Saída</option>
                  <option value="income">Entrada</option>
                  <option value="transfer">Transferência</option>
                </select>,
              )}
              {field(
                'Nome',
                <input
                  name="description"
                  required
                  maxLength={200}
                  placeholder={
                    kind === 'income'
                      ? 'Ex.: Salário'
                      : 'Ex.: Mercado, almoço, Uber'
                  }
                  defaultValue={String(item?.description || '')}
                />,
              )}
              <div className="form-grid">
                {field(
                  'Valor (R$)',
                  <input
                    name="amount"
                    inputMode="decimal"
                    required
                    defaultValue={item ? raw(item.amount_cents) : ''}
                    placeholder="0,00"
                  />,
                )}
                {field(
                  'Data',
                  <input
                    name="occurred_on"
                    type="date"
                    required
                    value={movementDate}
                    onChange={(e) => setMovementDate(e.target.value)}
                  />,
                )}
              </div>
              <input type="hidden" name="status" value="confirmed" />
              {kind === 'expense' &&
                field(
                  'Forma de pagamento',
                  <select
                    name="payment_method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option value="pix">PIX</option>
                    <option value="debit">Débito</option>
                    <option value="credit">Crédito</option>
                  </select>,
                )}
              {kind === 'expense' && method === 'credit' ? (
                <>
                  {field(
                    'Cartão',
                    <select
                      name="card_id"
                      required
                      defaultValue={String(item?.card_id || '')}
                    >
                      <option value="">Selecione o cartão</option>
                      {data.cards.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>,
                  )}
                  {field(
                    'Número de parcelas',
                    <input
                      type="number"
                      name="installment_count"
                      required
                      min={1}
                      max={120}
                      defaultValue={
                        data.installment_plans.find(
                          (p) => p.transaction_id === item?.id,
                        )?.installment_count || 1
                      }
                    />,
                  )}
                </>
              ) : cashAccounts.length === 1 && kind !== 'transfer' ? (
                <div className="payment-account">
                  <input
                    type="hidden"
                    name="account_id"
                    value={cashAccounts[0].id}
                  />
                  <small>Conta: {cashAccounts[0].name}</small>
                </div>
              ) : (
                field(
                  kind === 'transfer' ? 'Conta de origem' : 'Conta',
                  accounts('account_id', item?.account_id),
                )
              )}
              {kind === 'transfer' &&
                field(
                  'Conta de destino',
                  accounts(
                    'destination_account_id',
                    item?.destination_account_id,
                  ),
                )}
            </>
          )}
          {type === 'event_edit' && (
            <>
              {field(
                'Nome',
                <input
                  name="name"
                  required
                  defaultValue={String(item?.description || '')}
                />,
              )}
              {field(
                item?.event_type === 'invoice'
                  ? 'Valor total da fatura (R$)'
                  : 'Valor (R$)',
                <input
                  name="amount"
                  required
                  inputMode="decimal"
                  defaultValue={raw(item?.amount_cents)}
                />,
              )}
              {field(
                'Data',
                <input
                  name="date"
                  type="date"
                  required
                  max={item?.event_type === 'payment' ? today() : undefined}
                  defaultValue={String(item?.occurred_on || today())}
                />,
              )}
              {item?.event_type === 'payment' &&
                field('Conta', accounts('account_id', item?.account_id))}
              <p className="footnote">
                A alteração fica registrada no histórico. Valores futuros
                respeitam a data informada.
              </p>
            </>
          )}
          {['transaction', 'recurrence'].includes(type) && (
            <fieldset>
              <legend>Tags opcionais</legend>
              <div className="tag-picker">
                {allTags.map((t) => (
                  <label key={t.id}>
                    <input
                      name="tag_ids"
                      type="checkbox"
                      value={t.id}
                      checked={selectedTags.includes(t.id)}
                      onChange={(e) =>
                        setSelectedTags((tags) =>
                          e.target.checked
                            ? [...tags, t.id]
                            : tags.filter((id) => id !== t.id),
                        )
                      }
                    />
                    {t.name}
                  </label>
                ))}
              </div>
              <div className="inline-tag">
                <input
                  aria-label="Nova tag"
                  placeholder="Digite uma nova tag"
                  value={tagName}
                  maxLength={60}
                  onChange={(e) => setTagName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void addTag()
                    }
                  }}
                />
                <button
                  type="button"
                  className="secondary"
                  disabled={tagBusy || busy || !tagName.trim()}
                  onClick={() => void addTag()}
                >
                  {tagBusy ? 'Criando…' : '+ Criar tag'}
                </button>
              </div>
            </fieldset>
          )}
          {type === 'account' && (
            <>
              {field(
                'Nome da conta',
                <input
                  name="name"
                  required
                  maxLength={100}
                  defaultValue={String(item?.name || '')}
                />,
              )}
              {field(
                'Banco',
                <select
                  name="bank_code"
                  defaultValue={String(item?.bank_code || 'Santander')}
                >
                  {['Nubank', 'Santander', 'Itaú'].map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>,
              )}
              {field(
                'Saldo inicial (R$)',
                <input
                  name="opening_balance"
                  required
                  defaultValue={raw(item?.opening_balance_cents)}
                />,
              )}
              {field(
                'Limite de cheque especial (R$)',
                <input
                  name="overdraft_limit"
                  required
                  defaultValue={raw(item?.overdraft_limit_cents)}
                />,
              )}
              <p className="footnote">
                Santander é a conta para PIX, débito e movimentações bancárias.
                Nubank e Itaú ficam com saldo de conta zero; cadastre suas
                compras no crédito em Cartões.
              </p>
              <p className="footnote">
                Use valores reais confirmados. O saldo inicial fica bloqueado
                após a primeira movimentação; correções posteriores são
                lançamentos de ajuste.
              </p>
            </>
          )}
          {type === 'card' && (
            <>
              {field(
                'Nome do cartão',
                <input name="name" required maxLength={100} />,
              )}
              {field(
                'Conta prevista para pagamento',
                <select
                  name="account_id"
                  defaultValue={
                    cashAccounts.length === 1 ? cashAccounts[0].id : ''
                  }
                >
                  <option value="">Sem vínculo — somente consolidado</option>
                  {cashAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>,
              )}
              <div className="form-grid">
                {field(
                  'Dia de fechamento',
                  <input
                    name="closing_day"
                    type="number"
                    min={1}
                    max={31}
                    required
                  />,
                )}
                {field(
                  'Dia de vencimento',
                  <input
                    name="due_day"
                    type="number"
                    min={1}
                    max={31}
                    required
                  />,
                )}
              </div>
              <p className="footnote">
                Compra no dia do fechamento entra no próximo ciclo. Confirme
                esta política com seu emissor. Ciclos históricos são
                preservados.
              </p>
            </>
          )}
          {type === 'tag' &&
            field(
              'Nome',
              <input
                name="name"
                required
                maxLength={60}
                defaultValue={String(item?.name || '')}
              />,
            )}
          {type === 'recurrence' && (
            <>
              {field(
                'Descrição',
                <input
                  name="description"
                  required
                  defaultValue={String(item?.description || '')}
                />,
              )}
              {!item &&
                field(
                  'Tipo',
                  <select name="kind">
                    <option value="expense">Despesa</option>
                    <option value="income">Receita</option>
                  </select>,
                )}
              {field(
                'Valor (R$)',
                <input
                  name="amount"
                  required
                  defaultValue={item ? raw(item.amount_cents) : ''}
                />,
              )}
              {!item && field('Conta', accounts())}
              {field(
                'Dia do mês',
                <input
                  name="day"
                  type="number"
                  min={1}
                  max={31}
                  required
                  defaultValue={Number(item?.day || 1)}
                />,
              )}
              {!item &&
                field(
                  'Início',
                  <input
                    name="start_on"
                    type="date"
                    required
                    defaultValue={today()}
                  />,
                )}
              {field(
                'Fim (opcional)',
                <input
                  name="end_on"
                  type="date"
                  defaultValue={String(item?.end_on || '')}
                />,
              )}
              {item && (
                <label className="check">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={!!item.active}
                  />
                  Ativa
                </label>
              )}
              <p className="footnote">
                Dias inexistentes são ajustados ao último dia do mês. Alterações
                afetam ocorrências ainda não geradas.
              </p>
            </>
          )}
          {type === 'reminder' && (
            <>
              {field(
                'Título',
                <input
                  name="title"
                  required
                  defaultValue={String(item?.title || 'Revisar meus gastos')}
                />,
              )}
              {field(
                'Horário',
                <input
                  name="local_time"
                  type="time"
                  required
                  defaultValue={String(item?.local_time || '13:30').slice(0, 5)}
                />,
              )}
              <div className="weekday-picker">
                {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(
                  (d, i) => (
                    <label key={d}>
                      <input
                        name="weekdays"
                        type="checkbox"
                        value={i + 1}
                        defaultChecked={
                          !item || (item.weekdays as number[]).includes(i + 1)
                        }
                      />
                      {d}
                    </label>
                  ),
                )}
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  name="enabled"
                  defaultChecked={!item || !!item.enabled}
                />
                Habilitado
              </label>
            </>
          )}
          {(type === 'payment' || type === 'settlement') && (
            <>
              {field('Conta de origem', accounts())}
              {field(
                'Valor efetivamente pago (R$)',
                <input
                  name="amount"
                  required
                  defaultValue={
                    type === 'payment'
                      ? raw(
                          Number(item?.total_cents) - Number(item?.paid_cents),
                        )
                      : ''
                  }
                />,
              )}
              {field(
                'Data do pagamento',
                <input
                  name="paid_on"
                  type="date"
                  max={today()}
                  required
                  defaultValue={today()}
                />,
              )}
              {type === 'settlement' && (
                <>
                  <label className="check">
                    <input name="issuer_confirmed" type="checkbox" required />
                    Confirmo que a antecipação foi efetivada no emissor.
                  </label>
                  <p className="footnote">
                    Preserva parcelas pagas e registra a diferença entre o valor
                    original e pago na auditoria. Não executa operação no banco.
                  </p>
                </>
              )}
            </>
          )}
          {type === 'confirm_transaction' &&
            field(
              'Data efetiva',
              <input
                name="paid_on"
                type="date"
                required
                max={today()}
                defaultValue={today()}
              />,
            )}
          {['reverse_payment', 'unconfirm_transaction'].includes(type) && (
            <>
              <p>
                {String(item?.description || '')}. O registro será preservado no
                histórico e o saldo será recalculado.
              </p>
              {field(
                'Motivo',
                <textarea name="reason" required maxLength={500} />,
              )}
            </>
          )}
          {type === 'delete' && (
            <>
              <p>
                Excluir “{String(item?.description)}”? O histórico permanece na
                auditoria.
              </p>
              {field(
                'Motivo',
                <textarea name="reason" required maxLength={500} />,
              )}
            </>
          )}
          {(error || validation) && (
            <p className="error" role="alert">
              {validation || error}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={close}
            >
              Cancelar
            </button>
            <button className="primary" disabled={busy || tagBusy}>
              {busy
                ? 'Salvando…'
                : type === 'delete'
                  ? 'Confirmar exclusão'
                  : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
