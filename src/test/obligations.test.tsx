// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Obligations } from '../components/Obligations'
import { emptyData } from '../domain/types'
afterEach(cleanup)
it('mostra empréstimo Nubank junto às faturas e mantém o fluxo próprio de pagamento', () => {
  const loan = {
    id: 'loan',
    kind: 'expense',
    description: 'Parcela empréstimo',
    amount_cents: 68800,
    occurred_on: '2026-11-15',
    status: 'scheduled',
    payment_method: 'pix',
    account_id: 'cash',
    card_id: null,
    destination_account_id: null,
    source_type: 'import_commitment',
    related_bank_code: 'Nubank',
    version: 1,
    deleted_at: null,
    tag_ids: [],
  }
  const open = vi.fn()
  render(
    <Obligations data={{ ...emptyData, transactions: [loan] }} open={open} />,
  )
  expect(screen.getByText('Nubank · Empréstimo')).toBeTruthy()
  expect(screen.getByText(/parcela separada da fatura/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Pagar' }))
  expect(open).toHaveBeenCalledWith('confirm_transaction', loan)
})
