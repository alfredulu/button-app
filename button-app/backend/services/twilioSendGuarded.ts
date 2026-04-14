import { prisma } from "../prisma";
import { postTwilioSms } from "./twilioClient";
import {
  countUserSmsSuccessTodayUtc,
  logTwilioAttempt,
  type TwilioPurpose,
} from "./twilioLogService";
import { sendSecurityAlertEmail } from "./securityAlerts";

const MAX_SMS_PER_USER_PER_DAY = 5;
const FLAG_THRESHOLD_SMS_PER_DAY = 20;

export async function sendTwilioSmsGuarded(params: {
  userId: string | null;
  phoneTo: string;
  body: string;
  purpose: TwilioPurpose;
}): Promise<{ sid: string } | null> {
  const profile = params.userId
    ? await prisma.userProfile.findUnique({ where: { userId: params.userId } })
    : null;

  if (profile?.smsFlagged || profile?.smsBlockedAt) {
    await logTwilioAttempt({
      userId: params.userId,
      phoneTo: params.phoneTo,
      purpose: params.purpose,
      success: false,
      errorMessage: "user_sms_blocked",
    });
    return null;
  }

  if (params.userId) {
    const todaySuccess = await countUserSmsSuccessTodayUtc(params.userId);
    if (todaySuccess >= MAX_SMS_PER_USER_PER_DAY) {
      await logTwilioAttempt({
        userId: params.userId,
        phoneTo: params.phoneTo,
        purpose: params.purpose,
        success: false,
        errorMessage: "daily_sms_limit",
      });
      return null;
    }
  }

  const result = await postTwilioSms(params.phoneTo, params.body);

  await logTwilioAttempt({
    userId: params.userId,
    phoneTo: params.phoneTo,
    purpose: params.purpose,
    success: Boolean(result),
    twilioSid: result?.sid ?? null,
    errorMessage: result ? null : "twilio_send_failed",
  });

  if (params.userId && result) {
    const successToday = await countUserSmsSuccessTodayUtc(params.userId);
    if (successToday >= FLAG_THRESHOLD_SMS_PER_DAY) {
      await prisma.userProfile.updateMany({
        where: { userId: params.userId, smsFlagged: false },
        data: { smsFlagged: true, smsBlockedAt: new Date() },
      });
      await sendSecurityAlertEmail(
        "[Button] SMS abuse threshold — user flagged",
        `userId=${params.userId} sent ${successToday}+ successful SMS today (UTC). Account SMS blocked (smsFlagged).`
      );
    }
  }

  return result;
}
