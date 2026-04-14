import { prisma } from "../prisma";

const MAX_PER_DAY = 10;
const MAX_PER_MONTH = 50;

export type VoiceQuotaResult =
  | { ok: true }
  | { ok: false; reason: "daily" | "monthly" };

/**
 * Enforce max 10 voice sessions per user per calendar day (UTC) and 50 per calendar month (UTC).
 */
export async function assertVoiceSessionQuota(userId: string): Promise<VoiceQuotaResult> {
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

  const dayCount = await prisma.voiceSession.count({
    where: { userId, createdAt: { gte: startOfDay } },
  });
  if (dayCount >= MAX_PER_DAY) {
    return { ok: false, reason: "daily" };
  }

  const monthCount = await prisma.voiceSession.count({
    where: { userId, createdAt: { gte: startOfMonth } },
  });
  if (monthCount >= MAX_PER_MONTH) {
    return { ok: false, reason: "monthly" };
  }

  return { ok: true };
}
