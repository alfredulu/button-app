import { z } from "zod";
import { sanitizeUserText } from "../lib/sanitize";
import { prisma } from "../prisma";
import { refreshAccessTokenIfNeeded, ensureProfile } from "./googleCalendarTokens";
import { DEFAULT_TIME_ZONE, localHourAndMinuteInTimeZone, localYmdInTimeZone, utcInstantForLocalWallClock } from "../lib/zonedTime";
import { applyPlanningDayFromCalendarAdd } from "./streaks";
import { bumpWeekStatsAfterCalendarAdd } from "./weeklyScore";
import { rolloverWeekIfNeeded, resetMonthlyFreezeIfNeeded, ensureProBadgeProgressStarted } from "./profileWeek";
import { applyProBadgeStreak } from "./proBadgeStreak";
import {
  maybeAwardProBadgesAfterCalendarAdd,
  maybeAwardStreakBadges,
  maybeAwardWeekendWarrior,
} from "./badges";
import { scheduleSmsRemindersForEvents } from "./smsReminderSchedule";
import { getEffectivePlan } from "./planResolution";

const GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars";

export const calendarAddBodySchema = z.object({
  events: z.array(
    z.object({
      title: z
        .string()
        .min(1)
        .max(500)
        .transform((s) => sanitizeUserText(s, 500)),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().regex(/^\d{2}:\d{2}$/),
      description: z
        .string()
        .optional()
        .default("")
        .transform((s) => sanitizeUserText(s, 500)),
      durationMins: z.number().int().min(5).max(24 * 60).optional().default(60),
      location: z
        .string()
        .max(500)
        .optional()
        .transform((s) => (s === undefined ? undefined : sanitizeUserText(s, 500))),
    })
  ),
  calendarId: z.string().optional().default("primary"),
  timeZone: z.string().min(1).optional().default(DEFAULT_TIME_ZONE),
});

export type CalendarAddBody = z.infer<typeof calendarAddBodySchema>;

function formatLocalDateTime(dt: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

export type CreatedCalendarEvent = {
  title: string;
  googleEventId: string;
  date: string;
  time: string;
  durationMins: number;
  location?: string;
};

export async function addEventsViaGoogleCalendar(
  userId: string,
  body: CalendarAddBody
): Promise<{ created: CreatedCalendarEvent[] }> {
  const { events, calendarId, timeZone } = body;

  const accessToken = await refreshAccessTokenIfNeeded(userId);
  if (!accessToken) {
    throw new Error("NOT_CONNECTED");
  }

  const created: CreatedCalendarEvent[] = [];
  for (const ev of events) {
    const startDateTime = `${ev.date}T${ev.time}:00`;
    const end = new Date(`${ev.date}T${ev.time}:00`);
    end.setMinutes(end.getMinutes() + (ev.durationMins ?? 60));
    const endDateTime = formatLocalDateTime(end);

    const url = `${GOOGLE_CALENDAR_EVENTS_URL}/${encodeURIComponent(calendarId)}/events`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: ev.title,
        description: ev.description ?? "",
        location: ev.location,
        start: { dateTime: startDateTime, timeZone },
        end: { dateTime: endDateTime, timeZone },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[calendar-add] create event error", res.status, errBody);
      throw new Error("GOOGLE_API_ERROR");
    }

    const data = (await res.json()) as { id: string };
    created.push({
      title: ev.title,
      googleEventId: data.id,
      date: ev.date,
      time: ev.time,
      durationMins: ev.durationMins ?? 60,
      location: ev.location,
    });
  }

  return { created };
}

export async function runPostCalendarAddHooks(userId: string, created: CreatedCalendarEvent[], timeZone: string) {
  await getEffectivePlan(userId);
  const tz = timeZone || DEFAULT_TIME_ZONE;
  const now = new Date();
  const todayYmd = localYmdInTimeZone(now, tz);
  const { hour: planningHour } = localHourAndMinuteInTimeZone(now, tz);

  let profile = await ensureProfile(userId);
  profile = await ensureProBadgeProgressStarted(profile);
  profile = await rolloverWeekIfNeeded(profile);
  profile = await resetMonthlyFreezeIfNeeded(profile);

  let isNewPlanningDay = false;
  try {
    await prisma.planningDay.create({
      data: { userId, localDate: todayYmd, timeZone: tz },
    });
    isNewPlanningDay = true;
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code !== "P2002") throw e;
  }

  profile = await applyPlanningDayFromCalendarAdd(profile, todayYmd, tz);

  profile = await prisma.userProfile.update({
    where: { id: profile.id },
    data: { totalEventsScheduled: { increment: created.length } },
  });

  if (profile.plan === "pro") {
    profile = await bumpWeekStatsAfterCalendarAdd(profile, created.length, planningHour, isNewPlanningDay);
  }

  profile = await applyProBadgeStreak(profile, todayYmd);

  await maybeAwardProBadgesAfterCalendarAdd(profile, created.length, now);
  await maybeAwardStreakBadges(profile, profile.badgeEligibleStreak);
  await maybeAwardWeekendWarrior(userId, todayYmd, tz);

  await scheduleSmsRemindersForEvents(profile, created, tz, utcInstantForLocalWallClock);

  return { profile };
}
