import { Hono } from "hono";
import { rateLimit } from "../middleware/rateLimit";
import { verifyAppleServerNotificationJwt } from "../lib/verifyAppleNotificationJwt";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";
import { processAppleNotificationEvent } from "../services/appleNotificationService";
import { env } from "../env.ts";

/**
 * Sign in with Apple server-to-server notifications (TLS 1.2+).
 * POST body: { "payload": "<JWS>" }
 * @see https://developer.apple.com/documentation/sign_in_with_apple/processing_changes_for_sign_in_with_apple_accounts
 */
export const appleNotificationsRouter = new Hono();

appleNotificationsRouter.post("/apple/notifications", rateLimit("publicStrict"), async (c) => {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return c.json(
      { error: { message: "Apple notifications require SUPABASE_SERVICE_ROLE_KEY", code: "NOT_CONFIGURED" } },
      503
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid JSON", code: "BAD_REQUEST" } }, 400);
  }

  const payload = (body as { payload?: unknown }).payload;
  if (typeof payload !== "string" || payload.length === 0) {
    return c.json({ error: { message: "Missing or invalid payload", code: "BAD_REQUEST" } }, 400);
  }

  const audience =
    env.APPLE_NOTIFICATIONS_AUDIENCE?.trim() || "com.buttontech.button";

  const event = await verifyAppleServerNotificationJwt(payload, audience);
  if (!event) {
    return c.json({ error: { message: "Forbidden", code: "FORBIDDEN" } }, 403);
  }

  try {
    await processAppleNotificationEvent(event, admin);
  } catch (e) {
    console.error("[apple-notifications] handler error", e);
    return c.json({ error: { message: "Internal error", code: "INTERNAL_ERROR" } }, 500);
  }

  return c.json({ ok: true });
});
