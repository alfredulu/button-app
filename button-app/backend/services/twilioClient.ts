import { env } from "../env.ts";

export async function postTwilioSms(to: string, body: string): Promise<{ sid: string } | null> {
  const sid = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) {
    console.warn("[twilio] Missing TWILIO_* env; skip send");
    return null;
  }

  const statusCallback =
    env.BACKEND_URL.replace(/\/$/, "") + "/api/reminders/webhook";

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: to,
      From: from,
      Body: body,
      StatusCallback: statusCallback,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("[twilio] send failed", res.status, t);
    return null;
  }

  const data = (await res.json()) as { sid: string };
  return { sid: data.sid };
}
