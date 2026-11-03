export function reviewStreak(dates: string[], reference: string): number {
  const reviewed = new Set(dates)
  const current = new Date(reference + 'T12:00:00Z')
  const previous = () => current.setUTCDate(current.getUTCDate() - 1)
  if (!reviewed.has(reference)) previous()
  let count = 0
  while (reviewed.has(current.toISOString().slice(0, 10))) {
    count++
    previous()
  }
  return count
}
