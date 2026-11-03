import { expect, it } from 'vitest'
import { reviewStreak } from '../lib/reviews'
it('deriva sequência entre meses, permitindo revisão de hoje ainda pendente', () => {
  expect(
    reviewStreak(['2026-10-31', '2026-11-01', '2026-11-02'], '2026-11-03'),
  ).toBe(3)
  expect(
    reviewStreak(['2026-10-31', '2026-11-02', '2026-11-03'], '2026-11-03'),
  ).toBe(2)
  expect(reviewStreak([], '2026-11-03')).toBe(0)
})
