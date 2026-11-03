import { describe, expect, it } from 'vitest'

import { cents, split, money, today } from '../lib/money'

describe('centavos', () => {
  it('preserva resíduos sem perder centavos', () => {
    expect(split(10000, 3)).toEqual([3334, 3333, 3333])
    for (let n = 1; n < 120; n++)
      expect(split(99999, n).reduce((a, b) => a + b, 0)).toBe(99999)
  })

  it('converte BRL sem arredondar casas inválidas', () => {
    expect(cents('1.234,56')).toBe(123456)
    expect(cents('0,01')).toBe(1)
    expect(() => cents('1,234')).toThrow()
    expect(() => cents('-10')).toThrow()
    expect(() => cents('abc')).toThrow()
  })

  it('rejeita parcelas inválidas', () => {
    expect(() => split(1, 3)).toThrow()
    expect(() => split(100, 0)).toThrow()
  })

  it('formata moeda e data civil', () => {
    expect(money(-123)).toContain('1,23')
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
