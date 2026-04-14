import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../prisma";
import type { SupabaseUser } from "../auth";
import { rateLimit } from "../middleware/rateLimit";
import { upstashAuthIpLimit } from "../middleware/upstashLimits";
import { validateBody } from "../middleware/validation";
import { sendTwilioSmsGuarded } from "../services/twilioSendGuarded";
import { env } from "../env.ts";
import { sanitizeUserText } from "../lib/sanitize";
import {
  generatePhoneCodeSalt,
  hashPhoneCode,
  verifyPhoneCode,
  isE164Phone,
} from "../lib/phoneCode";
import { getEffectivePlan } from "../services/planResolution";
import { countPhoneVerificationSendsLastHour } from "../services/twilioLogService";

export const userRouter = new Hono<{ Variables: { user: SupabaseUser | null } }>();

const onboardingDataPayloadSchema = z
  .object({
    planning_time: z.enum(["morning", "midday", "evening", "varies"]),
    user_type: z.enum(["professional", "student", "parent", "founder"]),
    struggle: z.enum(["forgetting", "no_reminders", "manual_entry", "dont_plan"]),
  })
  .strict();

const patchSettingsSchema = z
  .object({
    displayName: z
      .string()
      .min(1)
      .max(80)
      .transform((s) => sanitizeUserText(s, 80))
      .optional(),
    username: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-zA-Z0-9_]+$/)
      .transform((s) => s.toLowerCase())
      .optional(),
    smsRemindersEnabled: z.boolean().optional(),
    defaultReminderKind: z.enum(["15", "30", "60", "120", "morning"]).optional(),
    expoPushToken: z.string().max(800).optional(),
    onboardingData: z.union([onboardingDataPayloadSchema, z.null()]).optional(),
  })
  .strict();

const phoneSendSchema = z.object({
  phone: z.string().min(10).max(20),
});

const phoneVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

function randomSixDigit(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const MAX_VERIFY_ATTEMPTS = 3;

userRouter.get("/profile", rateLimit("authDefault"), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  let profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
  if (!profile) profile = await prisma.userProfile.create({ data: { userId: user.id } });

  const safeUser = { id: user.id, email: user.email, role: user.role };

  return c.json({ data: { user: safeUser, profile } });
});

userRouter.get("/plan-status", rateLimit("authDefault"), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const plan = await getEffectivePlan(user.id);

  let profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
  if (!profile) profile = await prisma.userProfile.create({ data: { userId: user.id } });

  const now = new Date();
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  lastMonday.setHours(0, 0, 0, 0);

  let daysUsed: string[];
  try {
    const parsed: unknown = JSON.parse(profile.daysUsedThisWeek || "[]");
    daysUsed = Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    console.error("[user/plan-status] Failed to parse daysUsedThisWeek for user:", user.id);
    daysUsed = [];
  }

  if (new Date(profile.weekResetAt) < lastMonday) {
    daysUsed = [];
    await prisma.userProfile.update({
      where: { id: profile.id },
      data: { daysUsedThisWeek: "[]", weekResetAt: now },
    });
  }

  const isPro = plan === "pro";
  const daysRemaining = isPro ? 999 : Math.max(0, 3 - daysUsed.length);
  const today = now.toISOString().split("T")[0] as string;
  const canRecord = isPro || daysUsed.includes(today) || daysUsed.length < 3;

  return c.json({
    data: {
      plan,
      daysUsed: daysUsed.length,
      daysRemaining,
      isPro,
      canRecord,
      daysUsedList: daysUsed,
    },
  });
});

userRouter.get("/planning-profile", rateLimit("authDefault"), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const plan = await getEffectivePlan(user.id);

  let profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
  if (!profile) profile = await prisma.userProfile.create({ data: { userId: user.id } });

  const badges = await prisma.badge.findMany({
    where: { userId: user.id },
    orderBy: { earnedAt: "desc" },
    select: { badgeType: true, earnedAt: true },
  });

  const isPro = plan === "pro";

  return c.json({
    data: {
      currentStreak: profile.currentStreak,
      longestStreak: profile.longestStreak,
      weeklyScore: isPro ? profile.weeklyScore : 0,
      totalVoiceSessions: profile.totalVoiceSessions,
      totalEventsScheduled: profile.totalEventsScheduled,
      streakFreezeCredits: isPro ? profile.streakFreezeCredits : 0,
      username: profile.username,
      displayName: profile.displayName,
      memberSince: profile.createdAt,
      isPro,
      phoneNumber: profile.phoneNumber,
      verifiedPhone: profile.verifiedPhone,
      smsRemindersEnabled: profile.smsRemindersEnabled,
      defaultReminderKind: profile.defaultReminderKind,
      badges: isPro ? badges : badges.filter((b) => b.badgeType === "first_plan"),
    },
  });
});

userRouter.get("/partner-insights", rateLimit("authDefault"), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const plan = await getEffectivePlan(user.id);
  if (plan !== "pro") {
    return c.json({ error: { message: "Pro only", code: "PRO_REQUIRED" } }, 403);
  }

  const me = await prisma.userProfile.findUnique({ where: { userId: user.id } });
  if (!me?.accountabilityPartnerId) {
    return c.json({ data: { partner: null } });
  }

  const partner = await prisma.userProfile.findUnique({
    where: { userId: me.accountabilityPartnerId },
    select: {
      username: true,
      displayName: true,
      currentStreak: true,
      weeklyScore: true,
      longestStreak: true,
    },
  });

  return c.json({ data: { partner } });
});

userRouter.patch(
  "/settings",
  rateLimit("authDefault"),
  validateBody(patchSettingsSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

    const plan = await getEffectivePlan(user.id);

    let profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    if (!profile) profile = await prisma.userProfile.create({ data: { userId: user.id } });

    const body = c.req.valid("json");
    const isPro = plan === "pro";

    if (body.smsRemindersEnabled === true && !isPro) {
      return c.json({ error: { message: "SMS reminders are a Pro feature.", code: "PRO_REQUIRED" } }, 403);
    }

    const data: Record<string, unknown> = {};
    if (body.displayName !== undefined) data.displayName = body.displayName;
    if (body.username !== undefined) data.username = body.username;
    if (body.expoPushToken !== undefined) data.expoPushToken = body.expoPushToken;
    if (body.defaultReminderKind !== undefined && isPro) data.defaultReminderKind = body.defaultReminderKind;
    if (body.smsRemindersEnabled !== undefined && isPro) data.smsRemindersEnabled = body.smsRemindersEnabled;
    if (body.onboardingData !== undefined) data.onboardingData = body.onboardingData;

    if (Object.keys(data).length === 0) {
      return c.json({ data: { profile } });
    }

    try {
      profile = await prisma.userProfile.update({ where: { id: profile.id }, data });
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "P2002") {
        return c.json({ error: { message: "Username already taken", code: "USERNAME_TAKEN" } }, 409);
      }
      throw e;
    }

    return c.json({ data: { profile } });
  }
);

userRouter.post(
  "/phone/send-code",
  rateLimit("authStrict"),
  upstashAuthIpLimit,
  validateBody(phoneSendSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

    const plan = await getEffectivePlan(user.id);
    if (plan !== "pro") {
      return c.json({ error: { message: "Pro only", code: "PRO_REQUIRED" } }, 403);
    }

    const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      return c.json({ error: { message: "Profile not found", code: "NOT_FOUND" } }, 404);
    }

    if (profile.smsFlagged || profile.smsBlockedAt) {
      return c.json({ error: { message: "SMS is blocked for this account.", code: "SMS_BLOCKED" } }, 403);
    }

    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
      return c.json({ error: { message: "SMS not configured on server", code: "SMS_DISABLED" } }, 503);
    }

    const { phone: rawPhone } = c.req.valid("json");
    const phone = rawPhone.trim();
    if (!isE164Phone(phone)) {
      return c.json(
        { error: { message: "Phone must be in E.164 format (e.g. +15551234567).", code: "INVALID_PHONE" } },
        400
      );
    }

    const other = await prisma.userProfile.findFirst({
      where: {
        phoneNumber: phone,
        verifiedPhone: true,
        NOT: { userId: user.id },
      },
    });
    if (other) {
      return c.json(
        { error: { message: "This phone number is already verified on another account.", code: "PHONE_IN_USE" } },
        409
      );
    }

    const sendsLastHour = await countPhoneVerificationSendsLastHour(phone);
    if (sendsLastHour >= 3) {
      c.header("Retry-After", "3600");
      return c.json(
        { error: { message: "Too many verification attempts for this number. Try again later.", code: "RATE_LIMITED" } },
        429
      );
    }

    const code = randomSixDigit();
    const salt = generatePhoneCodeSalt();
    const codeHash = hashPhoneCode(code, salt);
    const expiresAt = new Date(Date.now() + 10 * 60_000);

    await prisma.phoneVerification.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        codeHash,
        codeSalt: salt,
        verifyAttempts: 0,
        expiresAt,
      },
      update: {
        codeHash,
        codeSalt: salt,
        verifyAttempts: 0,
        expiresAt,
      },
    });

    const sent = await sendTwilioSmsGuarded({
      userId: user.id,
      phoneTo: phone,
      body: `Your Button verification code is ${code}. It expires in 10 minutes.`,
      purpose: "verification",
    });
    if (!sent) {
      return c.json({ error: { message: "Could not send SMS", code: "SMS_SEND_FAILED" } }, 502);
    }

    await prisma.userProfile.update({
      where: { id: profile.id },
      data: { phoneNumber: phone, verifiedPhone: false },
    });

    return c.json({ data: { sent: true } });
  }
);

userRouter.post(
  "/phone/verify",
  rateLimit("authStrict"),
  upstashAuthIpLimit,
  validateBody(phoneVerifySchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

    const plan = await getEffectivePlan(user.id);
    if (plan !== "pro") {
      return c.json({ error: { message: "Pro only", code: "PRO_REQUIRED" } }, 403);
    }

    const profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      return c.json({ error: { message: "Profile not found", code: "NOT_FOUND" } }, 404);
    }

    const { code } = c.req.valid("json");
    const row = await prisma.phoneVerification.findUnique({ where: { userId: user.id } });
    if (!row || row.expiresAt < new Date()) {
      return c.json({ error: { message: "Invalid or expired code", code: "INVALID_CODE" } }, 400);
    }

    if (row.verifyAttempts >= MAX_VERIFY_ATTEMPTS) {
      return c.json({ error: { message: "Too many failed attempts. Request a new code.", code: "TOO_MANY_ATTEMPTS" } }, 429);
    }

    const ok = verifyPhoneCode(code, row.codeSalt, row.codeHash);
    if (!ok) {
      await prisma.phoneVerification.update({
        where: { userId: user.id },
        data: { verifyAttempts: { increment: 1 } },
      });
      return c.json({ error: { message: "Invalid or expired code", code: "INVALID_CODE" } }, 400);
    }

    await prisma.phoneVerification.delete({ where: { userId: user.id } });

    await prisma.userProfile.update({
      where: { id: profile.id },
      data: { verifiedPhone: true },
    });

    return c.json({ data: { verified: true } });
  }
);
