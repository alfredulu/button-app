import { Hono } from "hono";
import { prisma } from "../prisma";
import { env } from "../env.ts";
import { sendSecurityAlertEmail } from "../services/securityAlerts";

export const internalWeeklyRouter = new Hono();

function utcWeekStartMonday(d = new Date()): Date {
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff, 0, 0, 0, 0));
  return start;
}

internalWeeklyRouter.get("/weekly-digest", async (c) => {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) {
    return c.json({ error: { message: "Not configured", code: "NOT_CONFIGURED" } }, 503);
  }

  const auth = c.req.header("Authorization")?.trim() ?? "";
  if (auth !== `Bearer ${secret}`) {
    return c.json({ error: { message: "Forbidden", code: "FORBIDDEN" } }, 403);
  }

  const weekStart = utcWeekStartMonday();
  const now = new Date();

  const [signups, voiceSessions, smsSent, proCount, flagged] = await Promise.all([
    prisma.userProfile.count({ where: { createdAt: { gte: weekStart, lte: now } } }),
    prisma.voiceSession.count({ where: { createdAt: { gte: weekStart, lte: now } } }),
    prisma.twilioLog.count({
      where: {
        purpose: { in: ["verification", "reminder"] },
        success: true,
        createdAt: { gte: weekStart, lte: now },
      },
    }),
    prisma.userProfile.count({ where: { plan: "pro" } }),
    prisma.userProfile.count({ where: { smsFlagged: true } }),
  ]);

  const estOpenAiUsd = (voiceSessions * 0.15).toFixed(2);
  const estTwilioUsd = (smsSent * 0.02).toFixed(2);

  const text = [
    `Button weekly digest (UTC week starting ${weekStart.toISOString().slice(0, 10)})`,
    `New signups: ${signups}`,
    `Voice sessions: ${voiceSessions}`,
    `Est. OpenAI cost (rough): $${estOpenAiUsd}`,
    `SMS sent (success): ${smsSent}`,
    `Est. Twilio cost (rough): $${estTwilioUsd}`,
    `Active Pro (DB plan=pro): ${proCount}`,
    `Flagged SMS accounts: ${flagged}`,
  ].join("\n");

  await sendSecurityAlertEmail("[Button] Weekly digest", text);

  return c.json({
    data: {
      weekStart: weekStart.toISOString(),
      signups,
      voiceSessions,
      smsSent,
      proCount,
      flagged,
      estOpenAiUsd,
      estTwilioUsd,
    },
  });
});
