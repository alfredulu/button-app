import { differenceInCalendarDays, parseISO } from "date-fns";

/** Parse YYYY-MM-DD as UTC date-only for safe calendar-day diffs. */
export function parseYmdUtc(ymd: string): Date {
  return parseISO(`${ymd}T12:00:00.000Z`);
}

export function calendarDaysBetween(earlierYmd: string, laterYmd: string): number {
  return differenceInCalendarDays(parseYmdUtc(laterYmd), parseYmdUtc(earlierYmd));
}

export function isConsecutiveCalendarDays(previousYmd: string, todayYmd: string): boolean {
  return calendarDaysBetween(previousYmd, todayYmd) === 1;
}

export function currentMonthYearUtc(): string {
  return new Date().toISOString().slice(0, 7);
}

export function mondayWeekStartYmd(d: Date): string {
  const x = new Date(d);
  const day = x.getDay();
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const dayStr = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${dayStr}`;
}
