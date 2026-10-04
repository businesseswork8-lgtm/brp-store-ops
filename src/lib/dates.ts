// All business dates are in India time (IST), not UTC.
const IST = 'Asia/Kolkata'

/** YYYY-MM-DD for "today" in IST (or for the given date). */
export function istDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Add days to a YYYY-MM-DD string. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** Human readable date in IST, e.g. "Sat, 3 Oct 2026". */
export function displayDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
