import type { CreatedCalendarEvent } from "./calendarAdd";
import { utcInstantForLocalWallClock } from "../lib/zonedTime";

export function buildReminderSmsBody(ev: CreatedCalendarEvent, timeZone: string, reminderKind: string): string {
  const [h, m] = ev.time.split(":").map((x) => Number(x));
  const startUtc = utcInstantForLocalWallClock(ev.date, h, Number.isFinite(m) ? m : 0, timeZone);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(startUtc);

  if (reminderKind === "morning") {
    return `Good morning — you have ${ev.title} today at ${timeLabel}. Plan looks good 📅`;
  }

  const mins = reminderKind === "15" ? 15 : reminderKind === "30" ? 30 : reminderKind === "120" ? 120 : 60;
  const unit = mins === 60 ? "1 hour" : `${mins} minutes`;
  const loc = ev.location?.trim();
  if (loc) {
    return `Hey — ${ev.title} in ${unit} at ${loc}. Don't forget to leave early.`;
  }
  return `Hey — ${ev.title} in ${unit}. You've got this 👊`;
}
