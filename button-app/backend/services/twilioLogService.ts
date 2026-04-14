import { prisma } from "../prisma";

export type TwilioPurpose = "verification" | "reminder";

export async function logTwilioAttempt(params: {
  userId: string | null;
  phoneTo: string;
  purpose: TwilioPurpose;
  success: boolean;
  twilioSid?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  await prisma.twilioLog.create({
    data: {
      userId: params.userId,
      phoneTo: params.phoneTo,
      purpose: params.purpose,
      success: params.success,
      twilioSid: params.twilioSid ?? null,
      errorMessage: params.errorMessage ?? null,
    },
  });
}

function utcDayBounds(d = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

/** Successful outbound SMS for user today (UTC) — used for 5/day cap. */
export async function countUserSmsSuccessTodayUtc(userId: string): Promise<number> {
  const { start, end } = utcDayBounds();
  return prisma.twilioLog.count({
    where: {
      userId,
      purpose: { in: ["verification", "reminder"] },
      success: true,
      createdAt: { gte: start, lt: end },
    },
  });
}

/** All logged SMS attempts today (UTC) — abuse detection. */
export async function countUserSmsAttemptsTodayUtc(userId: string): Promise<number> {
  const { start, end } = utcDayBounds();
  return prisma.twilioLog.count({
    where: {
      userId,
      purpose: { in: ["verification", "reminder"] },
      createdAt: { gte: start, lt: end },
    },
  });
}

export async function countPhoneVerificationSendsLastHour(phoneE164: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60_000);
  return prisma.twilioLog.count({
    where: {
      phoneTo: phoneE164,
      purpose: "verification",
      success: true,
      createdAt: { gte: since },
    },
  });
}
