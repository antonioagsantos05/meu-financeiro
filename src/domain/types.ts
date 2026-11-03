export interface Account {
  id: string
  name: string
  bank_code: string
  opening_balance_cents: number
  overdraft_limit_cents: number
  version: number
  active: boolean
}

export interface Transaction {
  id: string
  description: string
  kind: string
  amount_cents: number
  occurred_on: string
  status: string
  payment_method: string
  account_id: string | null
  destination_account_id: string | null
  card_id: string | null
  version: number
  deleted_at: string | null
  tag_ids: string[]
}

export interface Card {
  id: string
  name: string
  closing_day: number
  due_day: number
  account_id: string | null
}

export interface Invoice {
  id: string
  card_id: string
  due_on: string
  status: string
  total_cents: number
  paid_cents: number
}

export interface Plan {
  id: string
  transaction_id: string
  total_cents: number
  installment_count: number
  status: string
  version: number
}

export interface Tag {
  id: string
  name: string
}

export interface Rule {
  id: string
  description: string
  kind: string
  amount_cents: number
  account_id: string
  day: number
  start_on: string
  end_on: string | null
  active: boolean
}

export interface Reminder {
  id: string
  title: string
  local_time: string
  weekdays: number[]
  enabled: boolean
}

export interface Payment {
  id: string
  account_id: string
  amount_cents: number
  paid_on: string
}

export interface Review {
  local_date: string
  had_spending: boolean
}

export interface Data {
  accounts: Account[]
  transactions: Transaction[]
  cards: Card[]
  invoices: Invoice[]
  installment_plans: Plan[]
  tags: Tag[]
  recurrence_rules: Rule[]
  reminder_rules: Reminder[]
  payments: Payment[]
  daily_reviews: Review[]
}

export const emptyData: Data = {
  accounts: [],
  transactions: [],
  cards: [],
  invoices: [],
  installment_plans: [],
  tags: [],
  recurrence_rules: [],
  reminder_rules: [],
  payments: [],
  daily_reviews: [],
}
