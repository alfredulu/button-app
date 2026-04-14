/**
 * User Route - Profile and plan status for the authenticated user.
 *
 * Security hardening applied per OWASP API Security Top 10.
 */

import { Hono } from "hono";
import { prisma } from "../prisma";
import type { SupabaseUser } from "../auth";
import { rateLimit } from "../middleware/rateLimit";

export const userRouter = new Hono<{ Variables: { user: SupabaseUser | null } }>();

userRouter.get(
  "/profile",
  // OWASP API4:2023 Unrestricted Resource Consumption - rate limit profile lookups
  rateLimit("authDefault"),
  async (c) => {
    // OWASP API1:2023 - Always verify authentication before any data access
    const user = c.get("user");
    if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

    let profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      profile = await prisma.userProfile.create({ data: { userId: user.id } });
    }

    // OWASP API3:2023 Broken Object Property Level Authorization - only return
    // explicitly whitelisted fields from the user object. The raw Supabase user
    // may contain internal fields (e.g. app_metadata, identities, aud) that
    // expose implementation details or privilege information to clients.
    const safeUser = {
      id: user.id,
      email: user.email,
      role: user.role,
    };

    return c.json({ data: { user: safeUser, profile } });
  }
);

userRouter.get(
  "/plan-status",
  // OWASP API4:2023 Unrestricted Resource Consumption
  rateLimit("authDefault"),
  async (c) => {
    // OWASP API1:2023 - Always verify authentication before any data access
    const user = c.get("user");
    if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

    let profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      profile = await prisma.userProfile.create({ data: { userId: user.id } });
    }

    // Check if week needs reset (last Monday)
    const now = new Date();
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    lastMonday.setHours(0, 0, 0, 0);

    // OWASP: Wrap JSON.parse in try-catch - corrupted or malformed DB values must not
    // crash the server or expose raw error details. Return a safe default on failure.
    let daysUsed: string[];
    try {
      const parsed: unknown = JSON.parse(profile.daysUsedThisWeek || "[]");
      daysUsed = Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      // OWASP: Log anomaly server-side for audit trail; recover gracefully
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

    const isPro = profile.plan === "pro";
    const daysRemaining = isPro ? 999 : Math.max(0, 3 - daysUsed.length);
    const today = now.toISOString().split("T")[0] as string;
    const canRecord = isPro || daysUsed.includes(today) || daysUsed.length < 3;

    return c.json({
      data: {
        plan: profile.plan,
        daysUsed: daysUsed.length,
        daysRemaining,
        isPro,
        canRecord,
        daysUsedList: daysUsed,
      },
    });
  }
);
