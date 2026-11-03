export const money = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
    cents / 100,
  )

export function cents(value: string): number {
  const normalized = value.trim().replace(/\./g, '').replace(',', '.')

  if (!/^\d+(\.\d{1,2})?$/.test(normalized))
    throw new Error('Informe um valor como 123,45.')

  const result = Math.round(Number(normalized) * 100)

  if (!Number.isSafeInteger(result)) throw new Error('Valor fora do limite.')

  return result
}

export function split(total: number, count: number) {
  if (
    !Number.isSafeInteger(total) ||
    total <= 0 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > total
  )
    throw new Error('Parcelamento inválido.')

  return Array.from(
    { length: count },
    (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0),
  )
}

export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
