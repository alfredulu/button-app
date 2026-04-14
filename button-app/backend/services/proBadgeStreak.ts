import { prisma } from "../prisma";
import type { UserProfile } from "@prisma/client";
import { isConsecutiveCalendarDays } from "../lib/calendarDates";

/**
 * Pro-only streak counter for badge milestones (no credit for free-plan planning days).
 */
export async function applyProBadgeStreak(
  profile: UserProfile,
  todayLocalYmd: string
): Promise<UserProfile> {
  if (profile.plan !== "pro" || !profile.proBadgeProgressStartedAt) return profile;

  if (profile.badgePlanningLocalDate === todayLocalYmd) return profile;

  let next = 1;
  if (profile.badgePlanningLocalDate) {
    if (isConsecutiveCalendarDays(profile.badgePlanningLocalDate, todayLocalYmd)) {
      next = profile.badgeEligibleStreak + 1;
    }
  }

  return prisma.userProfile.update({
    where: { id: profile.id },
    data: {
      badgePlanningLocalDate: todayLocalYmd,
      badgeEligibleStreak: next,
    },
  });
}
