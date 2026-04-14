import { prisma } from "../prisma";
import { sendSecurityAlert } from "./securityAlerts";

const MAX_SMS_PER_USER_PER_DAY = 5;
const MAX_SEND_CODE_ATTEMPTS_PER_PHONE_HOUR = 3;
const ABUSE_SMS_PER_USER_DAY = 20;

export async function countUserSmsTodayUtc(userId: string): Promise<number> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  return prisma.twilioLog.count({
    where: {
      userId,
      success: true,
      createdAt: { gte: start },
      purpose: { in: ["verification", "reminder"] },
    },
  });
}

export async function countPhoneVerificationSendsLastHour(phoneE164: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60_000);
  return prisma.twilioLog.count({
    where: {
      phoneTo: phoneE164,
      purpose: "verification",
      createdAt: { gte: since },
    },
  });
}

export async function logTwilioSms(params: {
  userId: string | null;
  phoneTo: string;
  purpose: "verification" | "reminder";
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

  if (!params.userId || !params.success) return;

  const dayTotal = await countUserSmsTodayUtc(params.userId);
  if (dayTotal >= ABUSE_SMS_PER_USER_DAY) {
    await prisma.userProfile.updateMany({
      where: { userId: params.userId, smsFlagged: false },
      data: { smsFlagged: true, smsBlockedAt: new Date() },
    });
    await sendSecurityAlert(
      "SMS abuse threshold",
      `User ${params.userId} exceeded ${ABUSE_SMS_PER_USER_DAY} SMS in one UTC day. Account flagged and SMS blocked.`
    );
  }
}

export async function assertCanSendUserSms(userId: string): Promise<{ ok: true } | { ok: false; code: string }> {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (profile?.smsFlagged) {
    return { ok: false, code: "SMS_BLOCKED" };
  }
  const n = await countUserSmsTodayUtc(userId);
  if (n >= MAX_SMS_PER_USER_PER_DAY) {
    return { ok: false, code: "SMS_DAILY_LIMIT" };
  }
  return { ok: true };
}

export async function assertCanSendVerificationToPhone(phoneE164: string): Promise<{ ok: true } | { ok: false; code: string }> {
  const n = await countPhoneVerificationSendsLastHour(phoneE164);
  if (n >= MAX_SEND_CODE_ATTEMPTS_PER_PHONE_HOUR) {
    return { ok: false, code: "PHONE_CODE_RATE" };
  }
  return { ok: true };
}
