// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ForecastCalendar } from '../components/ForecastCalendar'
afterEach(cleanup)
it('navega entre meses e mostra saldo e movimentos do dia selecionado', () => {
  render(
    <ForecastCalendar
      rows={[
        { day: '2026-11-03', real_cents: 5801, projected_cents: 5801 },
        { day: '2026-11-15', real_cents: 5801, projected_cents: -10000 },
        { day: '2026-12-01', real_cents: 5801, projected_cents: 20000 },
      ]}
      events={[
        {
          id: 'loan',
          kind: 'expense',
          description: 'Empréstimo Nubank',
          amount_cents: 10000,
          occurred_on: '2026-11-15',
          status: 'scheduled',
          payment_method: 'pix',
          account_id: 'cash',
          card_id: null,
          destination_account_id: null,
          version: 1,
          deleted_at: null,
          tag_ids: [],
        },
      ]}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /^15 novembro/ }))
  expect(screen.getByText('Empréstimo Nubank')).toBeTruthy()
  expect(screen.getByText('Agendado')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Próximo mês' }))
  expect(
    (screen.getByLabelText('Mês da projeção') as HTMLSelectElement).value,
  ).toBe('2026-12')
})
