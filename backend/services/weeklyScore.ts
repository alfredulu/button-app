import { prisma } from "../prisma";
import type { UserProfile } from "@prisma/client";

/**
 * Weekly score / 1000 — consistency: full 200 if 5+ distinct planning days with similar local hour.
 */
export function computeWeeklyScore(p: {
  weekPlannedDays: number;
  weekScheduledEvents: number;
  weekSameHourDays: number;
  currentStreak: number;
}): number {
  const daysScore = Math.min(400, p.weekPlannedDays * 80);
  const eventsScore = Math.min(300, Math.min(10, p.weekScheduledEvents) * 30);
  const consistencyScore =
    p.weekPlannedDays >= 5 && p.weekSameHourDays >= 5 ? 200 : Math.min(200, p.weekSameHourDays * 40);
  const streakBonus = p.currentStreak >= 7 ? 100 : 0;
  return Math.min(1000, daysScore + eventsScore + consistencyScore + streakBonus);
}

export async function bumpWeekStatsAfterCalendarAdd(
  profile: UserProfile,
  eventsAdded: number,
  planningLocalHour: number,
  isNewPlanningDay: boolean
): Promise<UserProfile> {
  const newEvents = profile.weekScheduledEvents + eventsAdded;

  let plannedDays = profile.weekPlannedDays;
  let sameHourDays = profile.weekSameHourDays;
  let planningHour = profile.weekPlanningHour;

  if (isNewPlanningDay) {
    if (plannedDays === 0) {
      plannedDays = 1;
      planningHour = planningLocalHour;
      sameHourDays = 1;
    } else {
      plannedDays += 1;
      if (planningHour !== null && Math.abs(planningLocalHour - planningHour) <= 1) {
        sameHourDays += 1;
      } else if (planningHour === null) {
        planningHour = planningLocalHour;
        sameHourDays += 1;
      }
    }
  }

  const weeklyScore = computeWeeklyScore({
    weekPlannedDays: plannedDays,
    weekScheduledEvents: newEvents,
    weekSameHourDays: sameHourDays,
    currentStreak: profile.currentStreak,
  });

  return prisma.userProfile.update({
    where: { id: profile.id },
    data: {
      weekPlannedDays: plannedDays,
      weekScheduledEvents: newEvents,
      weekPlanningHour: planningHour,
      weekSameHourDays: sameHourDays,
      weeklyScore,
    },
  });
}
