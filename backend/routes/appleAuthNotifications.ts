import { Hono } from "hono";
import { z } from "zod";
import { env } from "../env.ts";
import { rateLimit } from "../middleware/rateLimit";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { verifyAppleNotificationPayload } from "../lib/verifyAppleNotificationJwt";
import { processAppleNotificationEvent } from "../services/appleNotificationService";

const DEFAULT_APPLE_AUDIENCE = "com.buttontech.button";

const bodySchema = z.object({
  payload: z.string().min(1),
});

/**
 * Sign in with Apple server-to-server notifications.
 * Full path: POST /api/auth/apple/notifications
 */
export const appleAuthRouter = new Hono();

// Browsers and “ping URL” checks use GET — without this, they see 404 and think the route is missing.
appleAuthRouter.get("/apple/notifications", rateLimit("publicStrict"), (c) =>
  c.json({
    ok: true,
    path: "/api/auth/apple/notifications",
    note: "Apple sends POST with JSON { \"payload\": \"<JWS>\" }. This GET response only confirms the URL is routed.",
  })
);

appleAuthRouter.post("/apple/notifications", rateLimit("publicStrict"), async (c) => {
  if (!getSupabaseAdmin()) {
    return c.json(
      { error: { message: "Apple notifications require SUPABASE_SERVICE_ROLE_KEY", code: "NOT_CONFIGURED" } },
      503
    );
  }

  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid JSON", code: "BAD_REQUEST" } }, 400);
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ error: { message: "Expected JSON body { payload: string }", code: "BAD_REQUEST" } }, 400);
  }

  const audience = env.APPLE_NOTIFICATIONS_AUDIENCE?.trim() || DEFAULT_APPLE_AUDIENCE;

  let events;
  try {
    events = await verifyAppleNotificationPayload(parsed.data.payload, audience);
  } catch (err) {
    console.warn("[apple-notification] JWT verification failed:", err instanceof Error ? err.message : err);
    return c.json({ error: { message: "Invalid or unverified Apple token", code: "FORBIDDEN" } }, 403);
  }

  if (events.length === 0) {
    console.warn("[apple-notification] verified JWT but no parseable events");
  }

  for (const ev of events) {
    await processAppleNotificationEvent(ev);
  }

  return c.json({ received: true });
});
