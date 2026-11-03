export function monthPeriod(reference: string, offset = 0) {
  const date = new Date(reference + 'T12:00:00Z')
  const first = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1),
  )
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  )
  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10),
  }
}
export function addDays(date: string, count: number) {
  const day = new Date(date + 'T12:00:00Z')
  day.setUTCDate(day.getUTCDate() + count)
  return day.toISOString().slice(0, 10)
}
