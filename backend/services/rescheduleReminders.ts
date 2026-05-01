import type { UserProfile } from "@prisma/client";
import { prisma } from "../prisma";
import { scheduleSmsRemindersForEvents } from "./smsReminderSchedule";
import { utcInstantForLocalWallClock } from "../lib/zonedTime";
import type { CreatedCalendarEvent } from "./calendarAdd";

/**
 * Re-run SMS reminder scheduling for recent calendar rows (Pro + SMS enabled).
 * Used by POST /api/reminders/schedule (rate-limited).
 */
export async function rescheduleRemindersForUser(
  profile: UserProfile,
  timeZone: string
): Promise<{ scheduled: number }> {
  const events = await prisma.calendarEvent.findMany({
    where: {
      userId: profile.userId,
      calendarEventId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const created: CreatedCalendarEvent[] = events
    .filter((e) => e.calendarEventId)
    .map((e) => ({
      title: e.title,
      googleEventId: e.calendarEventId!,
      date: e.eventDate,
      time: e.eventTime,
      durationMins: 60,
      location: e.location ?? undefined,
    }));

  if (created.length === 0) {
    return { scheduled: 0 };
  }

  const toUtc = (ymd: string, hour: number, minute: number, tz: string) =>
    utcInstantForLocalWallClock(ymd, hour, minute, tz);

  await scheduleSmsRemindersForEvents(profile, created, timeZone, toUtc);
  return { scheduled: created.length };
}
