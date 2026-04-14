import { prisma } from "../prisma";
import type { UserProfile } from "@prisma/client";
import { isConsecutiveCalendarDays } from "../lib/calendarDates";

export async function applyPlanningDayFromCalendarAdd(
  profile: UserProfile,
  todayLocalYmd: string,
  timeZone: string
): Promise<UserProfile> {
  if (profile.lastPlanningLocalDate === todayLocalYmd) {
    return prisma.userProfile.update({
      where: { id: profile.id },
      data: { lastPlanningTimeZone: timeZone },
    });
  }

  let nextStreak = 1;
  if (profile.lastPlanningLocalDate) {
    if (isConsecutiveCalendarDays(profile.lastPlanningLocalDate, todayLocalYmd)) {
      nextStreak = profile.currentStreak + 1;
    }
  }

  const longest = Math.max(profile.longestStreak, nextStreak);

  return prisma.userProfile.update({
    where: { id: profile.id },
    data: {
      currentStreak: nextStreak,
      longestStreak: longest,
      lastPlanningLocalDate: todayLocalYmd,
      lastPlanningTimeZone: timeZone,
    },
  });
}
