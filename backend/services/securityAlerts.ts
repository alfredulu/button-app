import { env } from "../env.ts";

export async function sendSecurityAlertEmail(subject: string, textBody: string): Promise<void> {
  const to = env.SECURITY_ALERT_EMAIL?.trim();
  const key = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim();
  if (!to || !key || !from) {
    console.warn("[security-alert] Missing SECURITY_ALERT_EMAIL, RESEND_API_KEY, or RESEND_FROM_EMAIL");
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text: textBody,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("[security-alert] Resend failed", res.status, t);
  }
}
