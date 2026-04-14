import { prisma } from "../prisma";
import { env } from "../env.ts";
import { sendTwilioSmsGuarded } from "./twilioSendGuarded";

export async function processDueSmsReminders(): Promise<void> {
  if (!env.TWILIO_ACCOUNT_SID) return;

  const now = new Date();
  const due = await prisma.smsReminder.findMany({
    where: { sent: false, scheduledFor: { lte: now } },
    take: 50,
    orderBy: { scheduledFor: "asc" },
  });

  for (const row of due) {
    const profile = await prisma.userProfile.findUnique({ where: { userId: row.userId } });
    if (
      profile?.smsFlagged ||
      !profile?.phoneNumber ||
      !profile.verifiedPhone ||
      !profile.smsRemindersEnabled
    ) {
      await prisma.smsReminder.update({
        where: { id: row.id },
        data: { sent: true, sentAt: new Date(), deliveryStatus: "skipped_profile" },
      });
      continue;
    }

    const sent = await sendTwilioSmsGuarded(row.userId, profile.phoneNumber, row.messageBody, "reminder");
    await prisma.smsReminder.update({
      where: { id: row.id },
      data: {
        sent: Boolean(sent),
        sentAt: sent ? new Date() : null,
        twilioSid: sent?.sid ?? null,
        deliveryStatus: sent ? "queued" : "send_failed",
      },
    });
  }
}
