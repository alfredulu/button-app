/**
 * Sessions Route - List voice sessions for the authenticated user.
 *
 * Security hardening applied per OWASP API Security Top 10.
 */

import { Hono } from "hono";
import { prisma } from "../prisma";
import type { SupabaseUser } from "../auth";
import { rateLimit } from "../middleware/rateLimit";
import { validateQuery, sessionsQuerySchema } from "../middleware/validation";

export const sessionsRouter = new Hono<{ Variables: { user: SupabaseUser | null } }>();

sessionsRouter.get(
  "/",
  // OWASP API4:2023 Unrestricted Resource Consumption - 60 req/min is generous
  // for normal use while blocking scripted list-scraping attacks.
  rateLimit("authDefault"),
  // OWASP API3:2023 Broken Object Property Level Authorization - validate and
  // constrain query parameters to prevent unbounded data retrieval (e.g. limit=99999).
  validateQuery(sessionsQuerySchema),
  async (c) => {
    // OWASP API1:2023 Broken Object Level Authorization - always scope queries to
    // the authenticated user's ID. Never accept a user ID from query params.
    const user = c.get("user");
    if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

    const { limit } = c.req.valid("query");

    const sessions = await prisma.voiceSession.findMany({
      where: { userId: user.id },
      include: { events: true },
      orderBy: { createdAt: "desc" },
      // OWASP: Use validated limit from query params (max 50, default 50)
      take: limit,
    });

    return c.json({ data: sessions });
  }
);
