import { expect, it } from 'vitest'
import { addDays, monthPeriod } from '../lib/dates'
it('seleciona meses completos sem depender do fuso e trata viradas e ano bissexto', () => {
  expect(monthPeriod('2026-11-03')).toEqual({
    start: '2026-11-01',
    end: '2026-11-30',
  })
  expect(monthPeriod('2026-12-17', 1)).toEqual({
    start: '2027-01-01',
    end: '2027-01-31',
  })
  expect(monthPeriod('2028-02-15')).toEqual({
    start: '2028-02-01',
    end: '2028-02-29',
  })
  expect(addDays('2026-11-19', 14)).toBe('2026-12-03')
})
