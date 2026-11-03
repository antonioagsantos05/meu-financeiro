import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  LayoutDashboard,
  ArrowLeftRight,
  CalendarDays,
  Wallet,
  CreditCard,
  Repeat2,
  ChartNoAxesCombined,
  Bell,
  Settings,
  LogOut,
  X,
  Download,
  Check,
  Pencil,
  Trash2,
  Menu,
  Landmark,
} from 'lucide-react'
import { supabase } from './lib/supabase'
import { money, cents, today } from './lib/money'
import { emptyData } from './domain/types'
import type { Data, Transaction } from './domain/types'
import { Editor } from './components/Editor'
import './App.css'
import { enablePush, disablePush, pushConfigured } from './lib/push'
import { reviewStreak } from './lib/reviews'
export type Modal = { type: string; item?: Record<string, unknown> }
const nav = [
  { name: 'Início', icon: LayoutDashboard },
  { name: 'Movimentos', icon: ArrowLeftRight },
  { name: 'Futuro', icon: CalendarDays },
  { name: 'Contas', icon: Wallet },
  { name: 'Cartões', icon: CreditCard },
  { name: 'Recorrências', icon: Repeat2 },
  { name: 'Relatórios', icon: ChartNoAxesCombined },
  { name: 'Lembretes', icon: Bell },
  { name: 'Configurações', icon: Settings },
]
const statuses: Record<string, string> = {
  confirmed: 'Confirmado',
  scheduled: 'Agendado',
  estimated: 'Estimado',
  open: 'Aberta',
  partial: 'Parcial',
  paid: 'Paga',
  settled: 'Quitado',
}
const date = (s: string) =>
  new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
  })
const err = (e: unknown) =>
  e && typeof e === 'object' && 'message' in e
    ? String(e.message)
    : 'Não foi possível concluir a operação.'
type Forecast = { day: string; real_cents: number; projected_cents: number }
export function Brand() {
  return (
    <div className="brand">
      <span>
        <ChartNoAxesCombined size={24} />
      </span>
      <div>
        meu<b>financeiro</b>
        <small>SEU DINHEIRO. SEU RITMO.</small>
      </div>
    </div>
  )
}
export function Empty({
  title,
  text,
  action,
}: {
  title: string
  text: string
  action: () => void
}) {
  return (
    <div className="empty">
      <span>
        <Wallet size={25} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      <button className="secondary" onClick={action}>
        <Plus size={16} />
        Começar
      </button>
    </div>
  )
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(!supabase),
    [data, setData] = useState<Data>(emptyData)
  const [page, setPage] = useState('Início'),
    [menu, setMenu] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [modal, setModal] = useState<Modal | null>(null),
    [requestKey, setRequestKey] = useState(crypto.randomUUID())
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState(''),
    [account, setAccount] = useState(''),
    [tag, setTag] = useState(''),
    [card, setCard] = useState('')
  const [from, setFrom] = useState(today().slice(0, 7) + '-01'),
    [until, setUntil] = useState(today()),
    [scenario, setScenario] = useState('0,00'),
    [forecast, setForecast] = useState<Forecast[]>([])
  const [mode, setMode] = useState('login')
  const [balances, setBalances] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setError(error.message)
      setSession(data.session)
      setReady(true)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      setReady(true)
      if (event === 'PASSWORD_RECOVERY') setMode('password')
      if (!s) setData(emptyData)
    })
    return () => subscription.unsubscribe()
  }, [])
  const refresh = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    try {
      const entries = await Promise.all(
        Object.keys(emptyData).map(async (table) => {
          const rows: unknown[] = []
          for (let offset = 0; ; offset += 1000) {
            let q = supabase!
              .from(table)
              .select('*')
              .range(offset, offset + 999)
              .order(table === 'daily_reviews' ? 'local_date' : 'id')
            if (table === 'transactions' || table === 'tags')
              q = q.is('deleted_at', null)
            const { data, error } = await q
            if (error) throw error
            rows.push(...data)
            if (data.length < 1000) break
          }
          return [table, rows]
        }),
      )
      const { data: balances, error: balanceError } = await supabase.rpc(
        'get_account_balances',
      )
      if (balanceError) throw balanceError
      setBalances(
        Object.fromEntries(
          balances.map((b: { account_id: string; balance_cents: number }) => [
            b.account_id,
            b.balance_cents,
          ]),
        ),
      )
      setData(Object.fromEntries(entries) as unknown as Data)
    } catch (e) {
      setError(err(e))
    } finally {
      setLoading(false)
    }
  }, [])
  // Fetches authenticated remote state.
  useEffect(() => {
    if (session) {
      // oxlint-disable-next-line react/set-state-in-effect
      void refresh()
      if (location.pathname === '/movimentos/novo')
        setModal({ type: 'transaction' })
    }
  }, [session, refresh])
  function open(type: string, item?: object) {
    setRequestKey(crypto.randomUUID())
    setError('')
    setModal({ type, item: item as Record<string, unknown> })
  }
  async function command(
    operation: string,
    payload: Record<string, unknown>,
    key = crypto.randomUUID(),
  ) {
    if (!supabase) throw Error('Configure o Supabase.')
    const { error } = await supabase.rpc('command', {
      operation,
      payload,
      request_key: key,
    })
    if (error) throw error
  }
  async function action(op: string, payload: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      await command(op, payload)
      await refresh()
      setNotice('Alteração salva.')
    } catch (e) {
      setError(err(e))
    } finally {
      setBusy(false)
    }
  }
  async function save(op: string, payload: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      await command(op, payload, requestKey)
      setModal(null)
      setNotice('Salvo com sucesso.')
      await refresh()
    } catch (e) {
      setError(err(e))
    } finally {
      setBusy(false)
    }
  }
  async function auth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!supabase) return
    setBusy(true)
    setError('')
    const f = new FormData(e.currentTarget)
    try {
      if (mode === 'recover') {
        const { error } = await supabase.auth.resetPasswordForEmail(
          String(f.get('email')),
          { redirectTo: location.origin },
        )
        if (error) throw error
        setNotice('Se a conta existir, você receberá um e-mail de recuperação.')
      } else if (mode === 'password') {
        const { error } = await supabase.auth.updateUser({
          password: String(f.get('password')),
        })
        if (error) throw error
        setMode('login')
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: String(f.get('email')),
          password: String(f.get('password')),
        })
        if (error) throw error
      }
    } catch (e) {
      setError(err(e))
    } finally {
      setBusy(false)
    }
  }
  async function exportData() {
    if (!supabase) return
    setBusy(true)
    try {
      const content: Record<string, unknown> = {
        schema_version: 1,
        exported_at: new Date().toISOString(),
      }
      for (const table of [
        ...Object.keys(emptyData),
        'installments',
        'recurrence_occurrences',
        'audit_events',
      ]) {
        const rows: unknown[] = []
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase
            .from(table)
            .select('*')
            .order(table === 'daily_reviews' ? 'local_date' : 'id')
            .range(offset, offset + 999)
          if (error) throw error
          rows.push(...data)
          if (data.length < 1000) break
        }
        content[table] = rows
      }
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(content, null, 2)], {
          type: 'application/json',
        }),
      )
      const a = document.createElement('a')
      a.href = url
      a.download = `meu-financeiro-${today()}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(err(e))
    } finally {
      setBusy(false)
    }
  }
  const project = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    try {
      const end = new Date(today() + 'T12:00:00')
      end.setDate(end.getDate() + 90)
      const { data, error } = await supabase.rpc('get_forecast', {
        start_on: today(),
        end_on: end.toISOString().slice(0, 10),
        account_ids: account ? [account] : null,
        scenario_cents: scenario.startsWith('-')
          ? -cents(scenario.slice(1))
          : cents(scenario),
      })
      if (error) throw error
      setForecast(data)
    } catch (e) {
      setError(err(e))
    } finally {
      setLoading(false)
    }
  }, [account, scenario])
  // Synchronizes remote forecast data.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (session && page === 'Futuro') void project()
  }, [session, page, data, project])
  const txs = [...data.transactions].sort(
    (a, b) =>
      b.occurred_on.localeCompare(a.occurred_on) || a.id.localeCompare(b.id),
  )
  const balance = (id: string) => balances[id] ?? 0
  const total = data.accounts.reduce((s, a) => s + balance(a.id), 0),
    period = txs.filter((t) => t.occurred_on >= from && t.occurred_on <= until)
  const income = period
      .filter(
        (t) =>
          t.kind === 'income' &&
          t.status === 'confirmed' &&
          t.occurred_on <= today(),
      )
      .reduce((s, t) => s + t.amount_cents, 0),
    expense = period
      .filter(
        (t) =>
          t.kind === 'expense' &&
          t.status === 'confirmed' &&
          t.occurred_on <= today(),
      )
      .reduce((s, t) => s + t.amount_cents, 0)
  const accountName = (id: string | null) =>
      data.accounts.find((a) => a.id === id)?.name || 'Sem conta vinculada',
    cardName = (id: string | null) =>
      data.cards.find((c) => c.id === id)?.name || 'Cartão'
  const invoices = data.invoices
      .filter((i) => i.total_cents > 0)
      .sort((a, b) => a.due_on.localeCompare(b.due_on)),
    pending = invoices.filter((i) => i.total_cents > i.paid_cents)
  function transactions(items: Transaction[]) {
    return items.length ? (
      <div>
        {items.map((t) => (
          <div className="transaction" key={t.id}>
            <span
              className={
                'transaction-icon ' + (t.kind === 'income' ? 'positive' : '')
              }
            >
              {t.kind === 'income' ? (
                <ArrowDownLeft size={19} />
              ) : t.kind === 'transfer' ? (
                <ArrowLeftRight size={19} />
              ) : (
                <ArrowUpRight size={19} />
              )}
            </span>
            <div className="transaction-info">
              <strong>{t.description}</strong>
              <small>
                {date(t.occurred_on)} ·{' '}
                {t.payment_method === 'credit'
                  ? cardName(t.card_id)
                  : accountName(t.account_id)}{' '}
                · {t.payment_method.toUpperCase()}
              </small>
              <div className="tags">
                {data.tags
                  .filter((tag) => t.tag_ids.includes(tag.id))
                  .map((tag) => (
                    <span key={tag.id}>{tag.name}</span>
                  ))}
              </div>
            </div>
            <span className="status">{statuses[t.status]}</span>
            <strong
              className={'amount ' + (t.kind === 'income' ? 'positive' : '')}
            >
              {t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}{' '}
              {money(t.amount_cents)}
            </strong>
            <button
              className="icon-button"
              aria-label={'Editar ' + t.description}
              onClick={() => open('transaction', t)}
            >
              <Pencil size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={'Excluir ' + t.description}
              onClick={() => open('delete', t)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    ) : (
      <Empty
        title="Nenhum movimento por aqui"
        text="Cada registro é um passo para conhecer melhor o seu dinheiro."
        action={() => open('transaction')}
      />
    )
  }
  function accounts() {
    return (
      <div className="accounts-grid">
        {data.accounts.map((a) => (
          <button
            className="bank-card"
            key={a.id}
            onClick={() => open('account', a)}
          >
            <div>
              <span
                className={
                  'bank-logo ' + a.bank_code.toLowerCase().replace('ú', 'u')
                }
              >
                {a.bank_code === 'Nubank'
                  ? 'nu'
                  : a.bank_code === 'Itaú'
                    ? 'itaú'
                    : 'S'}
              </span>
              <span>
                {a.name}
                <small>{a.bank_code}</small>
              </span>
              <ArrowUpRight size={17} />
            </div>
            <strong className={balance(a.id) < 0 ? 'negative' : ''}>
              {money(balance(a.id))}
            </strong>
            <small>Saldo real em conta</small>
            {page === 'Contas' && (
              <p>
                Limite: {money(a.overdraft_limit_cents)}
                <br />
                Crédito disponível:{' '}
                {money(
                  Math.max(
                    0,
                    a.overdraft_limit_cents + Math.min(0, balance(a.id)),
                  ),
                )}
              </p>
            )}
          </button>
        ))}
        {!data.accounts.length && (
          <button className="add-account" onClick={() => open('account')}>
            <Plus size={24} />
            <strong>Cadastre sua primeira conta</strong>
            <span>Nubank, Santander ou Itaú</span>
          </button>
        )}
      </div>
    )
  }
  if (!ready) return <div className="auth-screen">Carregando acesso…</div>
  if (!session || mode === 'password')
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <Brand />
          <span className="eyebrow">CONTROLE PESSOAL • ACESSO PRIVADO</span>
          <h1>
            Mais tranquilidade.
            <br />
            <em>Um dia de cada vez.</em>
          </h1>
          <p>
            Suas contas, seus planos e o próximo passo. Tudo em um só lugar.
          </p>
          {!supabase ? (
            <div className="setup">
              <h3>Vamos conectar suas finanças</h3>
              <p>
                Configure as variáveis do Supabase em .env.local e aplique a
                migração do banco. O passo a passo está no README.
              </p>
              <small>Nenhum dado de demonstração foi inserido.</small>
            </div>
          ) : (
            <form onSubmit={auth}>
              {mode !== 'password' && (
                <label className="field">
                  E-mail
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                  />
                </label>
              )}
              {mode !== 'recover' && (
                <label className="field">
                  {mode === 'password' ? 'Nova senha' : 'Senha'}
                  <input
                    name="password"
                    type="password"
                    minLength={8}
                    required
                    autoComplete={
                      mode === 'password' ? 'new-password' : 'current-password'
                    }
                  />
                </label>
              )}
              <button className="primary" disabled={busy}>
                {busy
                  ? 'Aguarde…'
                  : mode === 'recover'
                    ? 'Enviar recuperação'
                    : mode === 'password'
                      ? 'Salvar senha'
                      : 'Entrar na minha conta'}
                <ArrowUpRight size={17} />
              </button>
              {mode !== 'password' && (
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    setMode(mode === 'login' ? 'recover' : 'login')
                  }
                >
                  {mode === 'login' ? 'Esqueci minha senha' : 'Voltar ao login'}
                </button>
              )}
            </form>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
          <small className="privacy">
            <Landmark size={14} /> Registro manual. Sem acesso aos seus bancos.
          </small>
        </div>
        <div className="auth-art">
          <div className="orb" />
          <span>
            Seu futuro começa
            <br />
            com o que você cuida hoje.
          </span>
        </div>
      </div>
    )
  return (
    <div className="app-shell">
      <aside className={menu ? 'sidebar mobile-open' : 'sidebar'}>
        <Brand />
        <div className="workspace-label">
          PESSOAL <span>PRIVADO</span>
        </div>
        <nav>
          {nav.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={page === name ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setPage(name)
                setMenu(false)
              }}
            >
              <Icon size={19} />
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="live-dot" />
          <span>
            Registro manual<small>Você no controle.</small>
          </span>
        </div>
        <button
          className="profile"
          onClick={async () => {
            const { error } = await supabase!.auth.signOut()
            if (error) setError(error.message)
          }}
        >
          <span className="avatar">
            {session.user.email?.[0].toUpperCase()}
          </span>
          <span>
            Minha conta<small>{session.user.email}</small>
          </span>
          <LogOut size={16} />
        </button>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <span className="muted">Meu Financeiro</span>
            <span>/</span>
            <span>{page}</span>
          </div>
          <div>
            <span className="today">
              {new Date(today() + 'T12:00:00').toLocaleDateString('pt-BR', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </span>
            <button
              className="icon-button"
              aria-label="Lembretes"
              onClick={() => setPage('Lembretes')}
            >
              <Bell size={18} />
            </button>
            <span className="avatar small">
              {session.user.email?.[0].toUpperCase()}
            </span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {page === 'Início'
                  ? 'BEM-VINDO AO SEU FINANCEIRO'
                  : 'SEU ESPAÇO FINANCEIRO'}
              </span>
              <h1>{page === 'Início' ? 'Seu dinheiro, com clareza.' : page}</h1>
              <p>
                {page === 'Início'
                  ? 'Acompanhe o presente. Planeje o que vem pela frente.'
                  : 'Organize cada detalhe da sua vida financeira.'}
              </p>
            </div>
            <button className="primary" onClick={() => open('transaction')}>
              <Plus size={18} />
              Novo movimento
            </button>
          </div>
          {error && !modal && (
            <div role="alert" className="error banner">
              {error}
              <button aria-label="Fechar erro" onClick={() => setError('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="success banner">
              <Check size={16} />
              {notice}
              <button aria-label="Fechar aviso" onClick={() => setNotice('')}>
                <X size={16} />
              </button>
            </div>
          )}
          {loading && (
            <div role="status" className="loading">
              Atualizando informações…
            </div>
          )}
          {page === 'Início' && (
            <>
              <div className="overview-grid">
                <section className="balance-card">
                  <div className="card-heading">
                    <span>SALDO TOTAL EM CONTAS</span>
                    <Wallet size={19} />
                  </div>
                  <div className="balance">{money(total)}</div>
                  <span className="balance-note">
                    <i className="live-dot" />
                    Saldo real · até hoje
                  </span>
                  <div className="balance-footer">
                    <span>{data.accounts.length} contas cadastradas</span>
                    <button onClick={() => setPage('Contas')}>
                      Ver contas <ArrowUpRight size={15} />
                    </button>
                  </div>
                </section>
                <section className="metric-card">
                  <span className="metric-icon positive">
                    <ArrowDownLeft size={22} />
                  </span>
                  <p>Entradas no mês até hoje</p>
                  <h2 className="positive">{money(income)}</h2>
                  <small>Receitas confirmadas</small>
                </section>
                <section className="metric-card">
                  <span className="metric-icon">
                    <ArrowUpRight size={22} />
                  </span>
                  <p>Despesas no mês até hoje</p>
                  <h2>{money(expense)}</h2>
                  <small>Compras, sem duplicar faturas</small>
                </section>
              </div>
              <div className="section-title">
                <h2>
                  Suas contas <span>{data.accounts.length}</span>
                </h2>
                <button className="text-button" onClick={() => open('account')}>
                  Adicionar conta <Plus size={15} />
                </button>
              </div>
              {accounts()}
              <div className="dashboard-columns">
                <section className="panel">
                  <div className="panel-title">
                    <h2>Últimos movimentos</h2>
                    <button
                      className="text-button"
                      onClick={() => setPage('Movimentos')}
                    >
                      Ver todos <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {transactions(txs.slice(0, 5))}
                </section>
                <section className="panel">
                  <div className="panel-title">
                    <h2>No seu radar</h2>
                    <CalendarDays size={18} />
                  </div>
                  {pending.slice(0, 3).map((i) => (
                    <div className="list-row" key={i.id}>
                      <span className="date-box">{date(i.due_on)}</span>
                      <div>
                        <strong>{cardName(i.card_id)}</strong>
                        <small>Fatura</small>
                      </div>
                      <b>{money(i.total_cents - i.paid_cents)}</b>
                    </div>
                  ))}
                  {!pending.length && (
                    <div className="radar-empty">
                      <Check size={25} />
                      <h3>Nenhuma fatura pendente</h3>
                      <p>Os próximos vencimentos aparecem aqui.</p>
                    </div>
                  )}
                  <div className="review-card">
                    <span className="eyebrow">UM HÁBITO QUE FAZ DIFERENÇA</span>
                    <h3>Como foi seu dia?</h3>
                    <p>
                      {data.daily_reviews.some((r) => r.local_date === today())
                        ? 'Revisão de hoje registrada.'
                        : 'Revise seus gastos, mesmo em dias sem compras.'}
                    </p>
                    <button
                      disabled={busy}
                      onClick={() =>
                        action('mark_daily_review', {
                          had_spending: txs.some(
                            (t) =>
                              t.kind === 'expense' && t.occurred_on === today(),
                          ),
                        })
                      }
                    >
                      <Check size={15} />
                      Concluir revisão de hoje
                    </button>
                    <small>
                      {reviewStreak(
                        data.daily_reviews.map((r) => r.local_date),
                        today(),
                      )}{' '}
                      dias em sequência · {data.daily_reviews.length} dias
                      revisados
                    </small>
                  </div>
                </section>
              </div>
            </>
          )}
          {page === 'Movimentos' && (
            <>
              <div className="filters">
                <input
                  aria-label="Buscar movimentos"
                  placeholder="Buscar movimento…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <input
                  aria-label="Data inicial"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <input
                  aria-label="Data final"
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
                <select
                  aria-label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">Todos os status</option>
                  {['confirmed', 'scheduled', 'estimated'].map((s) => (
                    <option key={s} value={s}>
                      {statuses[s]}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Conta"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">Todas as contas</option>
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Cartão"
                  value={card}
                  onChange={(e) => setCard(e.target.value)}
                >
                  <option value="">Todos os cartões</option>
                  {data.cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Tag"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                >
                  <option value="">Todas as tags</option>
                  {data.tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <section className="panel">
                <div className="panel-title">
                  <h2>Movimentos</h2>
                </div>
                {transactions(
                  period.filter(
                    (t) =>
                      t.description
                        .toLocaleLowerCase('pt-BR')
                        .includes(search.toLocaleLowerCase('pt-BR')) &&
                      (!status || t.status === status) &&
                      (!account ||
                        t.account_id === account ||
                        t.destination_account_id === account) &&
                      (!tag || t.tag_ids.includes(tag)) &&
                      (!card || t.card_id === card),
                  ),
                )}
              </section>
              <section className="panel tags-panel">
                <div className="panel-title">
                  <h2>Suas tags</h2>
                  <button className="secondary" onClick={() => open('tag')}>
                    <Plus size={15} />
                    Nova tag
                  </button>
                </div>
                <div className="tag-manager">
                  {data.tags.map((t) => (
                    <span key={t.id}>
                      {t.name}
                      <button
                        aria-label={'Editar tag ' + t.name}
                        onClick={() => open('tag', t)}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        aria-label={'Excluir tag ' + t.name}
                        disabled={busy}
                        onClick={() => action('delete_tag', { id: t.id })}
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
                <p className="footnote">
                  Remover uma tag preserva o movimento e a auditoria.
                </p>
              </section>
            </>
          )}
          {page === 'Contas' && (
            <>
              <div className="section-title">
                <h2>Contas bancárias</h2>
                <button className="secondary" onClick={() => open('account')}>
                  <Plus size={16} />
                  Adicionar conta
                </button>
              </div>
              {accounts()}
              <p className="footnote">
                Transferências são registradas em Novo movimento. Cheque
                especial é crédito separado do saldo. Encargos não são
                calculados sem taxas e regras aprovadas.
              </p>
            </>
          )}
          {page === 'Cartões' && (
            <>
              <div className="section-title">
                <h2>Cartões e faturas</h2>
                <button className="secondary" onClick={() => open('card')}>
                  <Plus size={16} />
                  Adicionar cartão
                </button>
              </div>
              <div className="accounts-grid">
                {data.cards.map((c) => (
                  <section className="credit-card" key={c.id}>
                    <CreditCard size={25} />
                    <span>MEU FINANCEIRO</span>
                    <h2>{c.name}</h2>
                    <p>
                      Fecha dia {c.closing_day} · vence dia {c.due_day}
                    </p>
                    <small>{accountName(c.account_id)}</small>
                  </section>
                ))}
              </div>
              {!data.cards.length && (
                <Empty
                  title="Adicione seu cartão"
                  text="Configure os dias reais de fechamento e vencimento."
                  action={() => open('card')}
                />
              )}
              <section className="panel">
                <div className="panel-title">
                  <h2>Faturas</h2>
                </div>
                {invoices.map((i) => (
                  <div className="list-row" key={i.id}>
                    <div>
                      <strong>{cardName(i.card_id)}</strong>
                      <small>
                        Vence {date(i.due_on)} · {statuses[i.status]}
                      </small>
                    </div>
                    <span>
                      {money(i.total_cents - i.paid_cents)}
                      <small>Pago: {money(i.paid_cents)}</small>
                    </span>
                    {i.status !== 'paid' && (
                      <button
                        className="secondary"
                        onClick={() => open('payment', i)}
                      >
                        Pagar
                      </button>
                    )}
                  </div>
                ))}
                {!invoices.length && (
                  <p className="empty-inline">
                    As faturas aparecem ao registrar compras no crédito.
                  </p>
                )}
              </section>
              <section className="panel">
                <div className="panel-title">
                  <h2>Compras parceladas</h2>
                </div>
                {data.installment_plans.map((p) => (
                  <div className="list-row" key={p.id}>
                    <div>
                      <strong>
                        {
                          txs.find((t) => t.id === p.transaction_id)
                            ?.description
                        }
                      </strong>
                      <small>
                        {p.installment_count} parcelas · {statuses[p.status]}
                      </small>
                    </div>
                    <b>{money(p.total_cents)}</b>
                    {p.status === 'open' && (
                      <button
                        className="secondary"
                        onClick={() => open('settlement', p)}
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                ))}
              </section>
            </>
          )}
          {page === 'Recorrências' && (
            <>
              <div className="section-title">
                <h2>Planeje o que se repete</h2>
                <button
                  className="secondary"
                  onClick={() => open('recurrence')}
                >
                  <Plus size={16} />
                  Nova recorrência
                </button>
              </div>
              <section className="panel">
                {data.recurrence_rules.map((r) => (
                  <div className="list-row" key={r.id}>
                    <div>
                      <strong>{r.description}</strong>
                      <small>
                        Dia {r.day} · {accountName(r.account_id)} ·{' '}
                        {r.active ? 'Ativa' : 'Pausada'}
                      </small>
                    </div>
                    <b>{money(r.amount_cents)}</b>
                    <button
                      className="icon-button"
                      aria-label={'Editar ' + r.description}
                      onClick={() => open('recurrence', r)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => action('toggle_recurrence', { id: r.id })}
                    >
                      {r.active ? 'Pausar' : 'Retomar'}
                    </button>
                  </div>
                ))}
                {!data.recurrence_rules.length && (
                  <Empty
                    title="Menos esquecimentos, mais previsibilidade"
                    text="Cadastre receitas e despesas mensais. Elas entram como estimadas."
                    action={() => open('recurrence')}
                  />
                )}
              </section>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  const end = new Date(today() + 'T12:00:00')
                  end.setDate(end.getDate() + 90)
                  void action('generate_recurrences', {
                    start_on: today(),
                    end_on: end.toISOString().slice(0, 10),
                  })
                }}
              >
                Gerar previsões dos próximos 90 dias
              </button>
              <p className="footnote">
                Reprocessar não duplica ocorrências. Alterações afetam apenas
                ocorrências ainda não geradas; edite as demais em Movimentos.
              </p>
            </>
          )}
          {page === 'Futuro' && (
            <>
              <div className="filters">
                <select
                  aria-label="Conta projetada"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">Todas as contas</option>
                  {data.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <label className="scenario">
                  Ajuste de cenário (R$)
                  <input
                    value={scenario}
                    onChange={(e) => setScenario(e.target.value)}
                    placeholder="-100,00"
                  />
                </label>
                <button className="secondary" onClick={() => void project()}>
                  Simular
                </button>
              </div>
              <p className="footnote">
                A simulação não altera dados. Considera saldo inicial,
                movimentos, recorrências já geradas e faturas abertas. Faturas
                sem conta vinculada entram apenas no consolidado. Não estima
                juros/IOF.
              </p>
              <section className="panel">
                <div className="panel-title">
                  <h2>Projeção diária · próximos 90 dias</h2>
                </div>
                <ForecastChart rows={forecast} />
                <ForecastCalendar rows={forecast} />
                <div className="forecast-day table-header">
                  <span>Data</span>
                  <span>Saldo real de referência</span>
                  <span>Previsto / cenário</span>
                </div>
                <div className="forecast-table">
                  {forecast.map((f) => (
                    <div className="forecast-day" key={f.day}>
                      <span>{date(f.day)}</span>
                      <span>{money(f.real_cents)}</span>
                      <strong
                        className={
                          f.projected_cents < 0 ? 'negative' : 'positive'
                        }
                      >
                        {money(f.projected_cents)}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}
          {page === 'Relatórios' && (
            <>
              <div className="filters">
                <input
                  aria-label="Início do relatório"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
                <input
                  aria-label="Fim do relatório"
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </div>
              <div className="overview-grid">
                {[
                  ['Receitas realizadas', income],
                  ['Despesas realizadas', expense],
                  [
                    'Despesas previstas',
                    period
                      .filter(
                        (t) => t.kind === 'expense' && t.status !== 'confirmed',
                      )
                      .reduce((s, t) => s + t.amount_cents, 0),
                  ],
                ].map(([title, value]) => (
                  <section className="metric-card" key={title}>
                    <p>{title}</p>
                    <h2>{money(Number(value))}</h2>
                  </section>
                ))}
              </div>
              <div className="dashboard-columns">
                <section className="panel">
                  <div className="panel-title">
                    <h2>Despesas por tag</h2>
                  </div>
                  {data.tags.map((tag) => {
                    const value = period
                      .filter(
                        (t) =>
                          t.kind === 'expense' && t.tag_ids.includes(tag.id),
                      )
                      .reduce((s, t) => s + t.amount_cents, 0)
                    return (
                      <div className="report-row" key={tag.id}>
                        <span>{tag.name}</span>
                        <div className="bar">
                          <i
                            style={{
                              width: `${Math.min(100, (value / (expense || 1)) * 100)}%`,
                            }}
                          />
                        </div>
                        <b>{money(value)}</b>
                      </div>
                    )
                  })}
                  <p className="footnote">
                    Grupos por tags se sobrepõem. O total geral conta cada
                    compra uma vez. Faturas e transferências não somam nova
                    despesa.
                  </p>
                </section>
                <section className="panel">
                  <div className="panel-title">
                    <h2>Por forma de pagamento</h2>
                  </div>
                  {['pix', 'debit', 'credit'].map((method) => (
                    <div className="list-row" key={method}>
                      <span>
                        {method === 'debit'
                          ? 'DÉBITO'
                          : method === 'credit'
                            ? 'CRÉDITO'
                            : 'PIX'}
                      </span>
                      <b>
                        {money(
                          period
                            .filter(
                              (t) =>
                                t.kind === 'expense' &&
                                t.payment_method === method,
                            )
                            .reduce((s, t) => s + t.amount_cents, 0),
                        )}
                      </b>
                    </div>
                  ))}
                </section>
              </div>
            </>
          )}
          {page === 'Lembretes' && (
            <>
              <div className="info-banner">
                <Bell size={22} />
                <div>
                  <strong>
                    {pushConfigured
                      ? 'Web Push configurado. Ative seu dispositivo.'
                      : 'Horários organizados. Envio push ainda não ativado.'}
                  </strong>
                  <p>
                    A entrega depende da conexão e das permissões do Android. O
                    agendador deve estar configurado para o envio.
                  </p>
                </div>
              </div>
              <div className="section-title">
                <h2>Seus lembretes</h2>
                <button
                  className="secondary"
                  disabled={busy || !pushConfigured}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await enablePush()
                      await refresh()
                      setNotice(
                        'Permissão e dispositivo registrados. A entrega depende do agendador.',
                      )
                    } catch (e) {
                      setError(err(e))
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Ativar neste dispositivo
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await disablePush()
                      setNotice('Envio revogado para todos os dispositivos.')
                    } catch (e) {
                      setError(err(e))
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Revogar dispositivos
                </button>
                <button className="secondary" onClick={() => open('reminder')}>
                  <Plus size={16} />
                  Novo lembrete
                </button>
              </div>
              <section className="panel">
                {data.reminder_rules.map((r) => (
                  <div className="list-row" key={r.id}>
                    <span className="reminder-time">
                      {r.local_time.slice(0, 5)}
                    </span>
                    <div>
                      <strong>{r.title}</strong>
                      <small>
                        {r.weekdays
                          .map(
                            (d) =>
                              ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'][
                                d - 1
                              ],
                          )
                          .join(' · ')}{' '}
                        · {r.enabled ? 'Habilitado' : 'Pausado'}
                      </small>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Editar lembrete"
                      onClick={() => open('reminder', r)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Excluir lembrete"
                      disabled={busy}
                      onClick={() => action('delete_reminder', { id: r.id })}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {!data.reminder_rules.length && (
                  <Empty
                    title="Crie seu hábito diário"
                    text="A sugestão é revisar às 13h30 e às 20h. Você escolhe os dias e horários."
                    action={() => open('reminder')}
                  />
                )}
              </section>
              <p className="footnote">
                Fuso America/Sao_Paulo. Nenhum valor financeiro deve ser exposto
                em notificações.
              </p>
            </>
          )}
          {page === 'Configurações' && (
            <div className="settings-grid">
              <section className="panel settings-panel">
                <h2>Minha conta</h2>
                <p>{session.user.email}</p>
                <p>Acesso privado · BRL · Português (Brasil)</p>
                <p>Fuso America/Sao_Paulo</p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    const { error } =
                      await supabase!.auth.resetPasswordForEmail(
                        session.user.email!,
                        { redirectTo: location.origin },
                      )
                    setBusy(false)
                    if (error) setError(error.message)
                    else setNotice('E-mail de recuperação solicitado.')
                  }}
                >
                  Redefinir senha
                </button>
              </section>
              <section className="panel settings-panel">
                <h2>Seus dados são seus</h2>
                <p>
                  Exporte registros e histórico de auditoria em JSON versão 1.
                </p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void exportData()}
                >
                  <Download size={16} />
                  Exportar dados
                </button>
                <p className="footnote">
                  Importação/restauração depende de um contrato validado. Guarde
                  o arquivo em local seguro.
                </p>
              </section>
              <section className="panel settings-panel">
                <h2>Instalação no Android</h2>
                <p>
                  No menu do navegador, escolha “Adicionar à tela inicial”. É
                  necessário estar online para acessar e salvar dados.
                </p>
                <p className="footnote">
                  Dados financeiros não são armazenados pelo cache offline.
                </p>
              </section>
            </div>
          )}
          <footer>
            MEU FINANCEIRO <span>Mais consciência em cada escolha.</span>
            <span className="footer-end">BRL · America/Sao_Paulo</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav">
        {nav.slice(0, 3).map(({ name, icon: Icon }) => (
          <button
            className={page === name ? 'active' : ''}
            key={name}
            onClick={() => setPage(name)}
          >
            <Icon size={20} />
            {name}
          </button>
        ))}
        <button onClick={() => setMenu(!menu)}>
          <Menu size={20} />
          Menu
        </button>
      </nav>
      {modal && (
        <Editor
          modal={modal}
          data={data}
          busy={busy}
          error={error}
          close={() => setModal(null)}
          save={save}
        />
      )}
    </div>
  )
}
function ForecastChart({ rows }: { rows: Forecast[] }) {
  if (!rows.length)
    return <p className="empty-inline">Nenhuma projeção carregada.</p>
  const values = rows.flatMap((r) => [r.real_cents, r.projected_cents]),
    min = Math.min(0, ...values),
    max = Math.max(1, ...values),
    y = (v: number) => 170 - ((v - min) / (max - min)) * 140,
    points = rows
      .map(
        (r, i) =>
          `${(i / (rows.length - 1 || 1)) * 900},${y(r.projected_cents)}`,
      )
      .join(' ')
  return (
    <div className="chart">
      <svg
        viewBox="0 0 900 200"
        role="img"
        aria-label="Saldo projetado nos próximos 90 dias"
      >
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity=".3" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[30, 100, 170].map((y) => (
          <line
            key={y}
            x1="0"
            x2="900"
            y1={y}
            y2={y}
            stroke="#2b2e34"
            strokeDasharray="4 6"
          />
        ))}
        <polygon points={`0,200 ${points} 900,200`} fill="url(#fill)" />
        <polyline
          points={points}
          stroke="#4ade80"
          fill="none"
          strokeWidth="3"
        />
        <line
          x1="0"
          x2="900"
          y1={y(rows[0].real_cents)}
          y2={y(rows[0].real_cents)}
          stroke="#7c8491"
          strokeDasharray="5 5"
        />
      </svg>
      <div>
        <span>{date(rows[0].day)}</span>
        <strong>{money(rows.at(-1)!.projected_cents)} ao final</strong>
        <span>{date(rows.at(-1)!.day)}</span>
      </div>
    </div>
  )
}
function ForecastCalendar({ rows }: { rows: Forecast[] }) {
  const months = [...new Set(rows.map((row) => row.day.slice(0, 7)))]
  return (
    <div className="calendar-grid">
      {months.map((month) => {
        const entries = rows.filter((row) => row.day.startsWith(month))
        const first = new Date(entries[0].day + 'T12:00:00Z')
        const offset = (first.getUTCDay() + 6) % 7
        return (
          <section className="calendar-month" key={month}>
            <h3>
              {first.toLocaleDateString('pt-BR', {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </h3>
            <div className="calendar-cells">
              {['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map((d, i) => (
                <small key={i}>{d}</small>
              ))}
              {Array.from({ length: offset }, (_, i) => (
                <span key={'empty' + i} />
              ))}
              {entries.map((row) => (
                <div
                  className={
                    row.projected_cents < 0
                      ? 'calendar-cell below'
                      : 'calendar-cell'
                  }
                  key={row.day}
                  title={`${row.day}: ${money(row.projected_cents)}`}
                >
                  <span>{Number(row.day.slice(8))}</span>
                  <small>{money(row.projected_cents)}</small>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
