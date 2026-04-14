import { env } from "../env.ts";

/**
 * Security / abuse alerts. Prefer Resend when configured; always log.
 */
export async function sendSecurityAlert(subject: string, body: string): Promise<void> {
  const line = `[SECURITY] ${subject}: ${body}`;
  console.error(line);

  const to = env.SECURITY_ALERT_EMAIL;
  const resendKey = env.RESEND_API_KEY;
  if (!to || !resendKey) return;

  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.RESEND_FROM_EMAIL ?? "Button Security <onboarding@resend.dev>",
        to: [to],
        subject: `[Button] ${subject}`,
        text: body,
      }),
    });
  } catch (e) {
    console.error("[securityAlerts] Resend failed:", e);
  }
}
