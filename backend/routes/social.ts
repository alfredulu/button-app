import { Hono } from "hono";
import { z } from "zod";
import type { SupabaseUser } from "../auth";
import { prisma } from "../prisma";
import { rateLimit } from "../middleware/rateLimit";
import { validateBody } from "../middleware/validation";
import { stripHtmlAndScripts } from "../lib/stripHtml";
import { getEffectivePlan } from "../services/planResolution";

const partnerSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/)
    .transform((s) => s.toLowerCase()),
});

export const socialRouter = new Hono<{ Variables: { user: SupabaseUser | null } }>();

socialRouter.get("/search", rateLimit("authDefault"), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const me = await prisma.userProfile.findUnique({ where: { userId: user.id } });
  const isPro = (await getEffectivePlan(user.id)) === "pro";
  if (!me || !isPro) {
    return c.json({ error: { message: "Pro only", code: "PRO_REQUIRED" } }, 403);
  }

  const q = stripHtmlAndScripts((c.req.query("q") ?? "").trim().toLowerCase());
  if (q.length < 2) return c.json({ data: { users: [] as { username: string; displayName: string | null }[] } });

  const rows = await prisma.userProfile.findMany({
    where: {
      userId: { not: user.id },
      plan: "pro",
      username: { contains: q },
    },
    take: 20,
    select: { username: true, displayName: true },
  });

  return c.json({
    data: {
      users: rows
        .filter((r) => r.username)
        .map((r) => ({ username: r.username as string, displayName: r.displayName })),
    },
  });
});

socialRouter.post(
  "/partner",
  rateLimit("authDefault"),
  validateBody(partnerSchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

    const me = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    const isProMe = (await getEffectivePlan(user.id)) === "pro";
    if (!me || !isProMe) {
      return c.json({ error: { message: "Pro only", code: "PRO_REQUIRED" } }, 403);
    }

    const { username } = c.req.valid("json");
    const target = await prisma.userProfile.findFirst({
      where: { username },
    });
    if (!target || target.userId === user.id) {
      return c.json({ error: { message: "User not found", code: "NOT_FOUND" } }, 404);
    }
    const targetPro = (await getEffectivePlan(target.userId)) === "pro";
    if (!targetPro) {
      return c.json({ error: { message: "Partner must be on Pro", code: "NOT_PRO" } }, 400);
    }

    if (target.accountabilityPartnerId && target.accountabilityPartnerId !== user.id) {
      return c.json({ error: { message: "They already have a partner", code: "PARTNER_TAKEN" } }, 409);
    }
    if (me.accountabilityPartnerId && me.accountabilityPartnerId !== target.userId) {
      return c.json({ error: { message: "You already have a partner", code: "YOU_HAVE_PARTNER" } }, 409);
    }

    await prisma.$transaction([
      prisma.userProfile.update({
        where: { id: me.id },
        data: { accountabilityPartnerId: target.userId },
      }),
      prisma.userProfile.update({
        where: { id: target.id },
        data: { accountabilityPartnerId: user.id },
      }),
    ]);

    return c.json({ data: { connected: true, partnerUsername: target.username } });
  }
);

socialRouter.delete("/partner", rateLimit("authDefault"), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const me = await prisma.userProfile.findUnique({ where: { userId: user.id } });
  if (!me?.accountabilityPartnerId) return c.json({ data: { disconnected: true } });

  const otherId = me.accountabilityPartnerId;
  const other = await prisma.userProfile.findUnique({ where: { userId: otherId } });

  await prisma.$transaction([
    prisma.userProfile.update({ where: { id: me.id }, data: { accountabilityPartnerId: null } }),
    ...(other
      ? [prisma.userProfile.update({ where: { id: other.id }, data: { accountabilityPartnerId: null } })]
      : []),
  ]);

  return c.json({ data: { disconnected: true } });
});
