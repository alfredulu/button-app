import { sendTwilioSms } from "./twilioClient";
import { assertCanSendUserSms, logTwilioSms } from "./twilioLogService";

/**
 * Send SMS with per-user daily cap and abuse flag checks. Logs every attempt.
 */
export async function sendTwilioSmsGuarded(
  userId: string,
  phoneTo: string,
  body: string,
  purpose: "verification" | "reminder"
): Promise<{ sid: string } | null> {
  const gate = await assertCanSendUserSms(userId);
  if (!gate.ok) {
    await logTwilioSms({
      userId,
      phoneTo,
      purpose,
      success: false,
      errorMessage: gate.code,
    });
    return null;
  }

  const result = await sendTwilioSms(phoneTo, body);
  await logTwilioSms({
    userId,
    phoneTo,
    purpose,
    success: Boolean(result),
    twilioSid: result?.sid ?? null,
    errorMessage: result ? null : "twilio_send_failed",
  });
  return result;
}
