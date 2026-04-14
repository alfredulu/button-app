import type { UserProfile } from "@prisma/client";
import { prisma } from "../prisma";
import { env } from "../env.ts";
import type { CreatedCalendarEvent } from "./calendarAdd";
import { buildReminderSmsBody } from "./smsReminderMessages";
import { sendTwilioSmsGuarded } from "./twilioSendGuarded";

type ToUtc = (ymd: string, hour: number, minute: number, timeZone: string) => Date;

export async function scheduleSmsRemindersForEvents(
  profile: UserProfile,
  created: CreatedCalendarEvent[],
  timeZone: string,
  toUtc: ToUtc,
  opts?: { isProEffective?: boolean }
): Promise<void> {
  const pro = opts?.isProEffective ?? profile.plan === "pro";
  if (!pro) return;
  if (!profile.smsRemindersEnabled || !profile.verifiedPhone || !profile.phoneNumber) return;
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) return;

  const kind = profile.defaultReminderKind;
  const now = new Date();

  for (const ev of created) {
    const [hhRaw, mmRaw] = ev.time.split(":").map((x) => Number(x));
    const hh = Number.isFinite(hhRaw) ? hhRaw : 0;
    const mm = Number.isFinite(mmRaw) ? mmRaw : 0;
    const eventStartUtc = toUtc(ev.date, hh, mm, timeZone);

    let scheduledFor: Date;
    if (kind === "morning") {
      scheduledFor = toUtc(ev.date, 8, 0, timeZone);
    } else {
      const mins = Number(kind);
      if (!Number.isFinite(mins) || mins <= 0) continue;
      scheduledFor = new Date(eventStartUtc.getTime() - mins * 60_000);
    }

    const messageBody = buildReminderSmsBody(ev, timeZone, kind);
    const phone = profile.phoneNumber;

    if (scheduledFor <= now) {
      const sent = await sendTwilioSmsGuarded(profile.userId, phone, messageBody, "reminder");
      await prisma.smsReminder.create({
        data: {
          userId: profile.userId,
          googleEventId: ev.googleEventId,
          title: ev.title,
          location: ev.location ?? null,
          eventStartAt: eventStartUtc,
          timeZone,
          reminderKind: kind,
          scheduledFor,
          messageBody,
          sent: Boolean(sent),
          sentAt: sent ? new Date() : null,
          twilioSid: sent?.sid ?? null,
        },
      });
    } else {
      await prisma.smsReminder.create({
        data: {
          userId: profile.userId,
          googleEventId: ev.googleEventId,
          title: ev.title,
          location: ev.location ?? null,
          eventStartAt: eventStartUtc,
          timeZone,
          reminderKind: kind,
          scheduledFor,
          messageBody,
          sent: false,
        },
      });
    }
  }
}
