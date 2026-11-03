// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { Editor } from '../components/Editor'
import { emptyData } from '../domain/types'
afterEach(cleanup)
const data = {
  ...emptyData,
  accounts: [
    {
      id: 'santander',
      name: 'Santander',
      bank_code: 'Santander',
      active: true,
      opening_balance_cents: 0,
      overdraft_limit_cents: 0,
      version: 1,
    },
  ],
}
it('cria e seleciona tag no movimento, preservando o que foi digitado', async () => {
  const createTag = vi.fn().mockResolvedValue({ id: 'new-tag', name: 'Comida' })
  const save = vi.fn().mockResolvedValue(undefined)
  render(
    <Editor
      modal={{ type: 'transaction' }}
      data={data}
      busy={false}
      error=""
      close={() => {}}
      save={save}
      createTag={createTag}
    />,
  )
  fireEvent.change(screen.getByLabelText('Nome'), {
    target: { value: 'Almoço' },
  })
  fireEvent.change(screen.getByLabelText('Valor (R$)'), {
    target: { value: '25,00' },
  })
  fireEvent.change(screen.getByLabelText('Nova tag'), {
    target: { value: 'Comida' },
  })
  fireEvent.click(screen.getByRole('button', { name: '+ Criar tag' }))
  await waitFor(() =>
    expect((screen.getByLabelText('Comida') as HTMLInputElement).checked).toBe(
      true,
    ),
  )
  expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe(
    'Almoço',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      'create_transaction',
      expect.objectContaining({
        description: 'Almoço',
        amount_cents: 2500,
        account_id: 'santander',
        tag_ids: ['new-tag'],
      }),
    ),
  )
  expect(createTag).toHaveBeenCalledTimes(1)
})
it('reutiliza tag existente e mostra erro sem descartar o movimento', async () => {
  const createTag = vi.fn().mockRejectedValue(new Error('Sem conexão'))
  render(
    <Editor
      modal={{ type: 'transaction' }}
      data={{ ...data, tags: [{ id: 'food', name: 'Comida' }] }}
      busy={false}
      error=""
      close={() => {}}
      save={vi.fn()}
      createTag={createTag}
    />,
  )
  fireEvent.change(screen.getByLabelText('Nova tag'), {
    target: { value: 'comida' },
  })
  fireEvent.keyDown(screen.getByLabelText('Nova tag'), { key: 'Enter' })
  await waitFor(() =>
    expect((screen.getByLabelText('Comida') as HTMLInputElement).checked).toBe(
      true,
    ),
  )
  expect(createTag).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Nome'), {
    target: { value: 'Mercado' },
  })
  fireEvent.change(screen.getByLabelText('Nova tag'), {
    target: { value: 'Nova' },
  })
  fireEvent.click(screen.getByRole('button', { name: '+ Criar tag' }))
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Sem conexão'),
  )
  expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe(
    'Mercado',
  )
})
it('usa Entrada/Saída sem seletor de confirmação e permite editar evento importado', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  const first = render(
    <Editor
      modal={{ type: 'transaction' }}
      data={data}
      busy={false}
      error=""
      close={() => {}}
      save={save}
      createTag={vi.fn()}
    />,
  )
  expect(screen.getByRole('option', { name: 'Entrada' })).toBeTruthy()
  expect(screen.getByRole('option', { name: 'Saída' })).toBeTruthy()
  expect(screen.queryByLabelText('Status')).toBeNull()
  first.unmount()
  render(
    <Editor
      modal={{
        type: 'event_edit',
        item: {
          id: 'virtual',
          original_id: 'source',
          event_type: 'income_estimate',
          description: 'Salário',
          amount_cents: 10000,
          occurred_on: '2099-11-30',
          version: 2,
        },
      }}
      data={data}
      busy={false}
      error=""
      close={() => {}}
      save={save}
      createTag={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('Valor (R$)'), {
    target: { value: '200,00' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      'edit_financial_event',
      expect.objectContaining({
        entity: 'income_estimate',
        id: 'source',
        amount_cents: 20000,
        version: 2,
      }),
    ),
  )
})
it('cria um movimento a partir da data escolhida no calendário', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  render(
    <Editor
      modal={{ type: 'transaction', item: { occurred_on: '2026-12-05' } }}
      data={data}
      busy={false}
      error=""
      close={() => {}}
      save={save}
      createTag={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText('Nome'), {
    target: { value: 'Dentista' },
  })
  fireEvent.change(screen.getByLabelText('Valor (R$)'), {
    target: { value: '417,00' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      'create_transaction',
      expect.objectContaining({
        occurred_on: '2026-12-05',
        amount_cents: 41700,
      }),
    ),
  )
})
