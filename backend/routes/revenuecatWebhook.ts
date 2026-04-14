import { Hono } from "hono";
import { prisma } from "../prisma";
import { env } from "../env.ts";
import { invalidatePlanCache } from "../services/planResolution";

type RcEvent = {
  type?: string;
  app_user_id?: string;
};

/**
 * RevenueCat server notifications. Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET> (dashboard).
 */
export const revenuecatWebhookRouter = new Hono();

revenuecatWebhookRouter.post("/", async (c) => {
  const secret = env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: { message: "Webhook not configured", code: "DISABLED" } }, 503);
  }

  const auth = c.req.header("authorization") ?? c.req.header("Authorization");
  if (auth !== `Bearer ${secret}`) {
    return c.json({ error: { message: "Forbidden", code: "INVALID_SIGNATURE" } }, 403);
  }

  let body: { event?: RcEvent };
  try {
    body = (await c.req.json()) as { event?: RcEvent };
  } catch {
    return c.json({ error: { message: "Invalid JSON", code: "BAD_REQUEST" } }, 400);
  }

  const ev = body.event;
  const userId = ev?.app_user_id;
  if (!userId || typeof userId !== "string") {
    return c.json({ received: true });
  }

  const t = ev.type ?? "";
  const proEvents = new Set([
    "INITIAL_PURCHASE",
    "RENEWAL",
    "PRODUCT_CHANGE",
    "UNCANCELLATION",
    "SUBSCRIPTION_EXTENDED",
  ]);
  const freeEvents = new Set(["CANCELLATION", "EXPIRATION", "BILLING_ISSUE"]);

  if (proEvents.has(t)) {
    await prisma.userProfile.updateMany({ where: { userId }, data: { plan: "pro" } });
    invalidatePlanCache(userId);
  } else if (freeEvents.has(t)) {
    await prisma.userProfile.updateMany({ where: { userId }, data: { plan: "free" } });
    invalidatePlanCache(userId);
  }

  return c.json({ received: true });
});
