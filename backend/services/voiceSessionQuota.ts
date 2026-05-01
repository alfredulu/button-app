import { prisma } from "../prisma";

const DAY_MS = 24 * 60 * 60_000;

export function utcDayStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

export function utcMonthStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

export async function countVoiceSessionsUtcDay(userId: string, dayStart: Date): Promise<number> {
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  return prisma.voiceSession.count({
    where: { userId, createdAt: { gte: dayStart, lt: dayEnd } },
  });
}

export async function countVoiceSessionsUtcMonth(userId: string, monthStart: Date): Promise<number> {
  const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return prisma.voiceSession.count({
    where: { userId, createdAt: { gte: monthStart, lt: monthEnd } },
  });
}

export const MAX_VOICE_SESSIONS_PER_DAY = 10;
export const MAX_VOICE_SESSIONS_PER_MONTH = 50;
