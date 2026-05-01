import { createHmac, timingSafeEqual } from "crypto";
import { Hono } from "hono";
import { prisma } from "../prisma";
import { env } from "../env.ts";
import { rateLimit } from "../middleware/rateLimit";

/**
 * Twilio status callback — no JWT; validates X-Twilio-Signature.
 */
export const remindersPublicRouter = new Hono();

/** Browsers use GET; Twilio status callbacks use POST with X-Twilio-Signature. */
remindersPublicRouter.get("/webhook", (c) =>
  c.text("Twilio webhook — use POST with application/x-www-form-urlencoded body and X-Twilio-Signature.", 200)
);

remindersPublicRouter.post("/webhook", rateLimit("publicStrict"), async (c) => {
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
