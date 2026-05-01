import { Hono } from "hono";
import { env } from "../env.ts";
import { fetchRevenueCatSubscriber, isProFromRevenueCatPayload } from "../services/revenueCat";
import { applyRevenueCatWebhookPlan } from "../services/planResolution";

export const revenuecatWebhookRouter = new Hono();

function extractAppUserId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const ev = o.event;
  if (ev && typeof ev === "object") {
    const id = (ev as Record<string, unknown>).app_user_id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  const top = o.app_user_id;
  if (typeof top === "string" && top.length > 0) return top;
  return null;
}

revenuecatWebhookRouter.post("/", async (c) => {
  const secret = env.REVENUECAT_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return c.json({ error: { message: "Webhook not configured", code: "NOT_CONFIGURED" } }, 503);
  }

  const auth = c.req.header("Authorization")?.trim() ?? "";
  const expectedBearer = `Bearer ${secret}`;
  const ok = auth === expectedBearer || auth === secret;
  if (!ok) {
    return c.json({ error: { message: "Forbidden", code: "FORBIDDEN" } }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid JSON", code: "BAD_REQUEST" } }, 400);
  }

  const appUserId = extractAppUserId(body);
  if (!appUserId) {
    return c.json({ ok: true });
  }

  const ent = env.REVENUECAT_ENTITLEMENT_PRO?.trim();
  if (!ent) {
    return c.json({ ok: true });
  }

  const sub = await fetchRevenueCatSubscriber(appUserId);
  const isPro = isProFromRevenueCatPayload(sub, ent);
  await applyRevenueCatWebhookPlan(appUserId, isPro);

  return c.json({ ok: true });
});

revenuecatWebhookRouter.get("/", (c) => c.text("ok", 200));
