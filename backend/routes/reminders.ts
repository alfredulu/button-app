import { createHmac, timingSafeEqual } from "crypto";
import { Hono } from "hono";
import { prisma } from "../prisma";
import { env } from "../env.ts";
import { rateLimit } from "../middleware/rateLimit";
import { requireAuth } from "../middleware/requireAuth";
import type { SupabaseUser } from "../auth";
import {
  hybridUserHourlyLimit,
  remindersScheduleHourlyLimit,
} from "../middleware/redisRateLimits";

/**
 * Twilio status callback — no JWT; validates X-Twilio-Signature.
 * POST /api/reminders/webhook
 */
export const remindersRouter = new Hono<{ Variables: { user: SupabaseUser | null } }>();

remindersRouter.post("/webhook", rateLimit("publicStrict"), async (c) => {
  const token = env.TWILIO_AUTH_TOKEN;
  if (!token) return c.text("ok", 200);

  const sig = c.req.header("X-Twilio-Signature");
  if (!sig) return c.text("Forbidden", 403);

  const bodyText = await c.req.text();
  const params = new URLSearchParams(bodyText);
  const flat: Record<string, string> = {};
  for (const [k, v] of params) flat[k] = v;

  const url = new URL(c.req.url).toString();
  const sortedKeys = Object.keys(flat).sort();
  let payload = url;
  for (const key of sortedKeys) payload += key + flat[key];

  const expected = createHmac("sha1", token).update(payload, "utf8").digest("base64");
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(sig, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return c.text("Forbidden", 403);
    }
  } catch {
    return c.text("Forbidden", 403);
  }

  const sid = flat["MessageSid"];
  const status = flat["MessageStatus"] ?? flat["SmsStatus"] ?? "";
  if (sid) {
    await prisma.smsReminder.updateMany({
      where: { twilioSid: sid },
      data: { deliveryStatus: status || "unknown" },
    });
  }

  return c.text("ok", 200);
});

/**
 * Rate-limited surface for “reminder scheduling” (SMS rows are created from calendar add).
 */
remindersRouter.post(
  "/schedule",
  rateLimit("authDefault"),
  hybridUserHourlyLimit(remindersScheduleHourlyLimit, 20, "rl:rsched", "authDefault"),
  requireAuth,
  async (c) => {
    return c.json({
      data: {
        ok: true,
        message:
          "SMS reminders are scheduled automatically when you add events via POST /api/calendar/add (or /api/google-calendar/add-events).",
      },
    });
  }
);
