import { prisma } from "../prisma";
import type { UserProfile } from "@prisma/client";
import { mondayWeekStartYmd } from "../lib/calendarDates";
import { maybeAwardConsistencyKing } from "./badges";

export async function ensureProBadgeProgressStarted(profile: UserProfile): Promise<UserProfile> {
  if (profile.plan !== "pro" || profile.proBadgeProgressStartedAt) return profile;
  return prisma.userProfile.update({
    where: { id: profile.id },
    data: {
      proBadgeProgressStartedAt: new Date(),
      badgePlanningLocalDate: null,
      badgeEligibleStreak: 0,
    },
  });
}

export async function rolloverWeekIfNeeded(profile: UserProfile): Promise<UserProfile> {
  const monday = mondayWeekStartYmd(new Date());
  if (profile.scoreWeekStart === monday) return profile;

  if (profile.scoreWeekStart && profile.weeklyScore > 0) {
    await prisma.weeklyScoreRecord.upsert({
      where: {
        userId_weekStart: { userId: profile.userId, weekStart: profile.scoreWeekStart },
      },
      create: {
        userId: profile.userId,
        weekStart: profile.scoreWeekStart,
        score: profile.weeklyScore,
      },
      update: { score: profile.weeklyScore },
    });
    await maybeAwardConsistencyKing(profile.userId);
  }

  return prisma.userProfile.update({
    where: { id: profile.id },
    data: {
      scoreWeekStart: monday,
      weekPlannedDays: 0,
      weekScheduledEvents: 0,
      weekPlanningHour: null,
      weekSameHourDays: 0,
      weeklyScore: 0,
    },
  });
}

export async function resetMonthlyFreezeIfNeeded(profile: UserProfile): Promise<UserProfile> {
  if (profile.plan !== "pro") return profile;
  const monthY = new Date().toISOString().slice(0, 7);
  if (profile.streakFreezeMonthYear === monthY) return profile;
  return prisma.userProfile.update({
    where: { id: profile.id },
    data: {
      streakFreezeMonthYear: monthY,
      streakFreezeCredits: 2,
    },
  });
}
