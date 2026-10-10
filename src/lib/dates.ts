// All business dates are in India time (IST), not UTC.
const IST = 'Asia/Kolkata'

/**
 * Stores close after midnight. Until this hour (IST), work still belongs to the
 * previous business day — e.g. a closing count at 12:40 AM is saved for "yesterday".
 */
export const BUSINESS_DAY_CUTOFF_HOUR = 6

/** Today's business date (YYYY-MM-DD) in IST, honouring the late-night cutoff (until 6:00 AM IST). */
export function businessDate(now: Date = new Date()): string {
  return istDate(new Date(now.getTime() - BUSINESS_DAY_CUTOFF_HOUR * 60 * 60 * 1000))
}

/** True when current IST time is between 12:00 AM and 5:59 AM (post-midnight closing shift). */
export function isLateNightShift(now: Date = new Date()): boolean {
  const istHour = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: IST, hour: 'numeric', hourCycle: 'h23' }).format(now),
    10
  )
  return istHour < BUSINESS_DAY_CUTOFF_HOUR
}

/** Raw calendar date (YYYY-MM-DD) in IST without late-night shift cutoff. */
export function calendarDate(now: Date = new Date()): string {
  return istDate(now)
}

/**
 * YYYY-MM-DD in IST.
 * - With no argument: the current BUSINESS / SALES date (see 6 AM cutoff above).
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

/** Human readable date, e.g. "Sat, 10 Oct 2026". Accepts YYYY-MM-DD, Date, or defaults to active business day. */
export function displayDate(d?: Date | string): string {
  const ymd = typeof d === 'string' ? d : d ? istDate(d) : businessDate()
  const [y, m, day] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-IN', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  })
}

/** Short human readable date, e.g. "Sat, 10 Oct". */
export function shortDate(ymd: string): string {
  if (!ymd) return ''
  const [y, m, day] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-IN', {
    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short',
  })
}

/**
 * Format timestamp in IST as time only, e.g. "11:15 AM" or "2:30 AM"
 */
export function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-IN', {
    timeZone: IST,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toUpperCase()
}

/**
 * Format timestamp in IST with date and time, e.g. "9 Oct, 2:30 AM" or "8 Oct, 11:15 AM"
 */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).toUpperCase()
}
