import { Hono } from "hono";
import { prisma } from "../prisma";
import { env } from "../env.ts";
import { sendSecurityAlert } from "../services/securityAlerts";

/**
 * Weekly digest placeholder — call from cron (Monday 9am) with header Authorization: Bearer CRON_SECRET.
 * Extend with OpenAI/Twilio cost estimates when billing APIs are wired.
 */
export const internalWeeklyRouter = new Hono();

internalWeeklyRouter.get("/weekly-digest", async (c) => {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return c.json({ error: { message: "CRON_SECRET not configured", code: "DISABLED" } }, 503);
  }
  const auth = c.req.header("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return c.json({ error: { message: "Forbidden", code: "UNAUTHORIZED" } }, 403);
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const [signups, sessions, smsCount, proCount, flagged] = await Promise.all([
    prisma.userProfile.count({ where: { createdAt: { gte: since } } }),
    prisma.voiceSession.count({ where: { createdAt: { gte: since } } }),
    prisma.twilioLog.count({ where: { success: true, createdAt: { gte: since } } }),
    prisma.userProfile.count({ where: { plan: "pro" } }),
    prisma.userProfile.count({ where: { smsFlagged: true } }),
  ]);

  const summary = [
    `Weekly digest (last 7 days)`,
    `New profiles: ${signups}`,
    `Voice sessions: ${sessions}`,
    `SMS sent (logged): ${smsCount}`,
    `Profiles marked pro (DB): ${proCount}`,
    `SMS-flagged accounts: ${flagged}`,
  ].join("\n");

  await sendSecurityAlert("Weekly digest", summary);

  return c.json({
    data: {
      newProfiles: signups,
      voiceSessions: sessions,
      smsSent: smsCount,
      proProfilesDb: proCount,
      smsFlagged: flagged,
    },
  });
});
