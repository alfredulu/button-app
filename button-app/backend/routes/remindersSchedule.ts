import { Hono } from "hono";
import { z } from "zod";
import type { SupabaseUser } from "../auth";
import { prisma } from "../prisma";
import { rateLimit } from "../middleware/rateLimit";
import { upstashRemindersScheduleLimit } from "../middleware/upstashLimits";
import { validateBody } from "../middleware/validation";
import { getEffectivePlan } from "../services/planResolution";
import { rescheduleRemindersForUser } from "../services/rescheduleReminders";
import { DEFAULT_TIME_ZONE } from "../lib/zonedTime";

const scheduleBodySchema = z
  .object({
    timeZone: z.string().min(1).max(120).optional(),
  })
  .strict();

export const remindersAuthRouter = new Hono<{ Variables: { user: SupabaseUser | null } }>();

remindersAuthRouter.post(
  "/schedule",
  rateLimit("authDefault"),
  upstashRemindersScheduleLimit,
  validateBody(scheduleBodySchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

    const plan = await getEffectivePlan(user.id);
    if (plan !== "pro") {
      return c.json({ error: { message: "Pro only", code: "PRO_REQUIRED" } }, 403);
    }

    let profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    if (!profile) profile = await prisma.userProfile.create({ data: { userId: user.id } });

    if (!profile.smsRemindersEnabled || !profile.verifiedPhone || !profile.phoneNumber) {
      return c.json(
        { error: { message: "Enable SMS reminders and verify phone first.", code: "SMS_NOT_READY" } },
        400
      );
    }

    const body = c.req.valid("json");
    const timeZone = body.timeZone ?? DEFAULT_TIME_ZONE;
    const { scheduled } = await rescheduleRemindersForUser(profile, timeZone);

    return c.json({ data: { scheduled } });
  }
);
