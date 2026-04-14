import { Hono } from "hono";
import { prisma } from "../prisma";
import type { SupabaseUser } from "../auth";
import { rateLimit } from "../middleware/rateLimit";
import { validateQuery, sessionsQuerySchema } from "../middleware/validation";

export const sessionsRouter = new Hono<{ Variables: { user: SupabaseUser | null } }>();

sessionsRouter.get(
  "/",
  rateLimit("authDefault"),
  validateQuery(sessionsQuerySchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

    const { limit } = c.req.valid("query");

    const sessions = await prisma.voiceSession.findMany({
      where: { userId: user.id },
      include: { events: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return c.json({ data: sessions });
  }
);

