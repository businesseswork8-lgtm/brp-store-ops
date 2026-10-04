// All business dates are in India time (IST), not UTC.
const IST = 'Asia/Kolkata'

/**
 * Stores close after midnight. Until this hour (IST), work still belongs to the
 * previous business day — e.g. a closing count at 12:40 AM is saved for "yesterday".
 */
export const BUSINESS_DAY_CUTOFF_HOUR = 5

/** Today's business date (YYYY-MM-DD) in IST, honouring the late-night cutoff. */
export function businessDate(now: Date = new Date()): string {
  return istDate(new Date(now.getTime() - BUSINESS_DAY_CUTOFF_HOUR * 60 * 60 * 1000))
}

/**
 * YYYY-MM-DD in IST.
 * - With no argument: the current BUSINESS date (see cutoff above).
 * - With a date: that calendar date in IST.
 */
export function istDate(d?: Date): string {
  if (!d) return businessDate()
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Add days to a YYYY-MM-DD string. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** Human readable date, e.g. "Sat, 3 Oct 2026". Defaults to the current business day. */
export function displayDate(d?: Date): string {
  const ymd = d ? istDate(d) : businessDate()
  const [y, m, day] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-IN', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}
