import { addDays } from '@/lib/dates';

export type Frequency = 'daily' | 'fortnightly' | 'monthly' | 'none';

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  daily: 'Daily',
  fortnightly: 'Every 15 days',
  monthly: 'Monthly',
  none: 'Not counted',
};

const lastDayOfMonth = (ymd: string) => {
  const [y, m] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * Is this item due for counting on `today` (business date, YYYY-MM-DD)?
 * - daily: every day
 * - fortnightly: on the 1st and 16th, or if 15+ days since the last count
 * - monthly: on the last day of the month, or if 31+ days since the last count
 * - never counted before: always due (needs a starting count)
 */
export function isDue(freq: Frequency, lastCount: string | null, today: string): boolean {
  if (freq === 'none') return false;
  if (!lastCount) return true;
  if (lastCount === today) return true; // keep showing it today so the count can be corrected
  const day = Number(today.slice(8, 10));
  switch (freq) {
    case 'daily': return true;
    case 'fortnightly': return day === 1 || day === 16 || lastCount <= addDays(today, -15);
    case 'monthly': return day === lastDayOfMonth(today) || lastCount <= addDays(today, -31);
  }
}
