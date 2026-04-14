import { getISOWeek, getISOWeekYear } from "date-fns";
import { prisma } from "../prisma";
import type { UserProfile } from "@prisma/client";
import { utcInstantForLocalWallClock } from "../lib/zonedTime";

export const BADGE_TYPES = {
  FIRST_PLAN: "first_plan",
  STREAK_3: "streak_3",
  STREAK_7: "streak_7",
  STREAK_30: "streak_30",
  STREAK_100: "streak_100",
  EARLY_RISER: "early_riser",
  WEEKEND_WARRIOR: "weekend_warrior",
  SPEED_DEMON: "speed_demon",
  POWER_PLANNER: "power_planner",
  CONSISTENCY_KING: "consistency_king",
} as const;

async function awardBadge(userId: string, badgeType: string): Promise<void> {
  try {
    await prisma.badge.create({ data: { userId, badgeType } });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code !== "P2002") throw e;
  }
}

export async function maybeAwardFirstPlanBadge(userId: string): Promise<void> {
  await awardBadge(userId, BADGE_TYPES.FIRST_PLAN);
}

function proBadgeWindow(profile: UserProfile, at: Date): boolean {
  if (profile.plan !== "pro" || !profile.proBadgeProgressStartedAt) return false;
  return at >= profile.proBadgeProgressStartedAt;
}

export async function maybeAwardProBadgesAfterCalendarAdd(
  profile: UserProfile,
  eventsInRequest: number,
  at: Date
): Promise<void> {
  if (!proBadgeWindow(profile, at)) return;
  if (eventsInRequest >= 10) {
    await awardBadge(profile.userId, BADGE_TYPES.POWER_PLANNER);
  }
}

export async function maybeAwardProBadgesAfterTranscribe(
  profile: UserProfile,
  eventCount: number,
  durationSecs: number,
  at: Date
): Promise<void> {
  if (!proBadgeWindow(profile, at)) return;
  if (eventCount >= 5 && durationSecs < 20 && durationSecs > 0) {
    await awardBadge(profile.userId, BADGE_TYPES.SPEED_DEMON);
  }
}

export async function maybeAwardEarlyRiser(profile: UserProfile, at: Date, localHour: number): Promise<void> {
  if (!proBadgeWindow(profile, at)) return;
  if (localHour >= 7) return;
  if (profile.earlyRiserCount >= 5) return;
  const next = await prisma.userProfile.update({
    where: { id: profile.id },
    data: { earlyRiserCount: { increment: 1 } },
  });
  if (next.earlyRiserCount >= 5) {
    await awardBadge(profile.userId, BADGE_TYPES.EARLY_RISER);
  }
}

export async function maybeAwardStreakBadges(profile: UserProfile, badgeEligibleStreak: number): Promise<void> {
  if (profile.plan !== "pro" || !profile.proBadgeProgressStartedAt) return;
  if (badgeEligibleStreak >= 3) await awardBadge(profile.userId, BADGE_TYPES.STREAK_3);
  if (badgeEligibleStreak >= 7) await awardBadge(profile.userId, BADGE_TYPES.STREAK_7);
  if (badgeEligibleStreak >= 30) await awardBadge(profile.userId, BADGE_TYPES.STREAK_30);
  if (badgeEligibleStreak >= 100) await awardBadge(profile.userId, BADGE_TYPES.STREAK_100);
}

function weekKeyFromYmd(ymd: string, tz: string): string {
  const d = utcInstantForLocalWallClock(ymd, 12, 0, tz);
  return `${getISOWeekYear(d)}-W${getISOWeek(d)}`;
}

export async function maybeAwardWeekendWarrior(userId: string, localYmd: string, timeZone: string): Promise<void> {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile || profile.plan !== "pro" || !profile.proBadgeProgressStartedAt) return;

  const targetWeek = weekKeyFromYmd(localYmd, timeZone);
  const proStart = profile.proBadgeProgressStartedAt;
  const days = await prisma.planningDay.findMany({
    where: { userId, createdAt: { gte: proStart } },
  });
  let sat = false;
  let sun = false;
  for (const row of days) {
    if (weekKeyFromYmd(row.localDate, row.timeZone) !== targetWeek) continue;
    const inst = utcInstantForLocalWallClock(row.localDate, 12, 0, row.timeZone);
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: row.timeZone, weekday: "short" }).format(inst);
    if (wd === "Sat") sat = true;
    if (wd === "Sun") sun = true;
  }
  if (sat && sun) await awardBadge(userId, BADGE_TYPES.WEEKEND_WARRIOR);
}

export async function maybeAwardConsistencyKing(userId: string): Promise<void> {
  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile || profile.plan !== "pro" || !profile.proBadgeProgressStartedAt) return;

  const last4 = await prisma.weeklyScoreRecord.findMany({
    where: { userId },
    orderBy: { weekStart: "desc" },
    take: 4,
  });
  if (last4.length === 4 && last4.every((r) => r.score >= 800)) {
    await awardBadge(userId, BADGE_TYPES.CONSISTENCY_KING);
  }
}
