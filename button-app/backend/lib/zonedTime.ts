/**
 * Calendar date (YYYY-MM-DD) in a given IANA timezone for an instant.
 */
export function localYmdInTimeZone(date: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(date);
}

export function localHourAndMinuteInTimeZone(
  date: Date,
  timeZone: string
): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

/**
 * UTC instant when the wall clock reads hour:minute on ymd in timeZone.
 */
export function utcInstantForLocalWallClock(
  ymd: string,
  hour: number,
  minute: number,
  timeZone: string
): Date {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  if (!y || !m || !d) return new Date(NaN);

  let t = Date.UTC(y, m - 1, d, 12, 0, 0);
  for (let i = 0; i < 48; i++) {
    const date = new Date(t);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const yy = Number(parts.find((p) => p.type === "year")?.value);
    const mm = Number(parts.find((p) => p.type === "month")?.value);
    const dd = Number(parts.find((p) => p.type === "day")?.value);
    const hh = Number(parts.find((p) => p.type === "hour")?.value);
    const min = Number(parts.find((p) => p.type === "minute")?.value);

    if (yy === y && mm === m && dd === d && hh === hour && min === minute) {
      return date;
    }

    const want = Date.UTC(y, m - 1, d, hour, minute, 0);
    const got = Date.UTC(yy, mm - 1, dd, hh, min, 0);
    t += want - got;
  }

  return new Date(t);
}

export const DEFAULT_TIME_ZONE = "America/New_York";
