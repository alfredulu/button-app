import { Hono } from "hono";
import { prisma } from "../prisma";
import { env } from "../env.ts";
import type { SupabaseUser } from "../auth";
import { rateLimit } from "../middleware/rateLimit";
import { upstashTranscribeLimit } from "../middleware/upstashLimits";
import {
  ALLOWED_AUDIO_MIME_TYPES,
  MAX_AUDIO_SIZE_BYTES,
  safeParseJsonArray,
  extractedEventSchema,
  type ExtractedEvent,
} from "../middleware/validation";
import { ensureProBadgeProgressStarted } from "../services/profileWeek";
import {
  maybeAwardFirstPlanBadge,
  maybeAwardEarlyRiser,
  maybeAwardProBadgesAfterTranscribe,
} from "../services/badges";
import {
  localHourAndMinuteInTimeZone,
  DEFAULT_TIME_ZONE,
} from "../lib/zonedTime";
import { getEffectivePlan } from "../services/planResolution";
import {
  countVoiceSessionsUtcDay,
  countVoiceSessionsUtcMonth,
  MAX_VOICE_SESSIONS_PER_DAY,
  MAX_VOICE_SESSIONS_PER_MONTH,
  utcDayStart,
  utcMonthStart,
} from "../services/voiceSessionQuota";

export const transcribeRouter = new Hono<{
  Variables: {
    user: SupabaseUser | null;
  };
}>();

transcribeRouter.post(
  "/",
  rateLimit("authStrict"),
  upstashTranscribeLimit,
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json(
        { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
        401
      );
    }

    const plan = await getEffectivePlan(user.id);

    let profile = await prisma.userProfile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      profile = await prisma.userProfile.create({ data: { userId: user.id } });
    }

    const now = new Date();
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    lastMonday.setHours(0, 0, 0, 0);

    let daysUsed: string[];
    try {
      daysUsed = JSON.parse(profile.daysUsedThisWeek || "[]") as string[];
      if (!Array.isArray(daysUsed)) daysUsed = [];
    } catch {
      console.error(
        "[transcribe] Failed to parse daysUsedThisWeek for user:",
        user.id
      );
      daysUsed = [];
    }

    if (new Date(profile.weekResetAt) < lastMonday) {
      daysUsed = [];
      await prisma.userProfile.update({
        where: { id: profile.id },
        data: { daysUsedThisWeek: "[]", weekResetAt: now },
      });
    }

    const today = now.toISOString().split("T")[0] as string;
    if (plan === "free" && !daysUsed.includes(today) && daysUsed.length >= 3) {
      return c.json(
        {
          error: {
            message:
              "You've used all 3 free days this week. Upgrade to Pro for unlimited access.",
            code: "PLAN_LIMIT",
          },
        },
        403
      );
    }

    const openaiKey = env.OPENAI_API_KEY;

    if (!openaiKey) {
      return c.json(
        {
          error: {
            message:
              "AI service not configured. Please add your OPENAI_API_KEY.",
            code: "NO_API_KEY",
          },
        },
        503
      );
    }

    const formData = await c.req.formData();
    const durationRaw = formData.get("durationSecs");
    const durationSecs =
      typeof durationRaw === "string" && durationRaw.trim() !== ""
        ? Math.min(24 * 3600, Math.max(0, Math.floor(Number(durationRaw))))
        : 0;
    const tzRaw = formData.get("timeZone");
    const sessionTimeZone =
      typeof tzRaw === "string" && tzRaw.trim().length > 0
        ? tzRaw.trim()
        : null;

    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) {
      return c.json(
        { error: { message: "No audio file provided", code: "NO_AUDIO" } },
        400
      );
    }

    if (
      !(ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(audioFile.type)
    ) {
      return c.json(
        {
          error: {
            message: `Unsupported audio format. Allowed types: ${ALLOWED_AUDIO_MIME_TYPES.join(
              ", "
            )}`,
            code: "INVALID_AUDIO_TYPE",
          },
        },
        400
      );
    }

    if (audioFile.size > MAX_AUDIO_SIZE_BYTES) {
      return c.json(
        {
          error: {
            message: `Audio file too large. Maximum size is ${
              MAX_AUDIO_SIZE_BYTES / (1024 * 1024)
            }MB`,
            code: "FILE_TOO_LARGE",
          },
        },
        400
      );
    }

    if (durationSecs < 1) {
      return c.json(
        {
          error: {
            message: "Audio must be at least 1 second long.",
            code: "AUDIO_TOO_SHORT",
          },
        },
        400
      );
    }

    const dayStart = utcDayStart(now);
    const monthStart = utcMonthStart(now);
    const [dayCount, monthCount] = await Promise.all([
      countVoiceSessionsUtcDay(user.id, dayStart),
      countVoiceSessionsUtcMonth(user.id, monthStart),
    ]);

    if (monthCount >= MAX_VOICE_SESSIONS_PER_MONTH) {
      const nextMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
      );
      c.header(
        "Retry-After",
        String(
          Math.max(60, Math.ceil((nextMonth.getTime() - now.getTime()) / 1000))
        )
      );
      return c.json(
        {
          error: {
            message: "Monthly limit reached. Try again next month.",
            code: "MONTHLY_LIMIT",
          },
        },
        429
      );
    }

    if (dayCount >= MAX_VOICE_SESSIONS_PER_DAY) {
      c.header("Retry-After", "86400");
      return c.json(
        {
          error: {
            message: "Daily limit reached. Try again tomorrow.",
            code: "DAILY_LIMIT",
          },
        },
        429
      );
    }

    try {
      const whisperForm = new FormData();
      whisperForm.append("file", audioFile);
      whisperForm.append("model", "whisper-1");

      const whisperRes = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${openaiKey}` },
          body: whisperForm,
        }
      );

      if (!whisperRes.ok) {
        const errBody = await whisperRes.text();
        console.error(
          "[transcribe] Whisper API error:",
          whisperRes.status,
          errBody
        );
        return c.json(
          {
            error: {
              message: "Audio transcription failed. Please try again.",
              code: "WHISPER_ERROR",
            },
          },
          500
        );
      }

      const whisperData = (await whisperRes.json()) as { text: string };
      const transcript = whisperData.text;

      const chatRes = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [
              {
                role: "system",
                content: `You are a calendar assistant. Extract all events from the user's spoken text. Today's date is ${today}. If no date is mentioned assume tomorrow. Return ONLY a valid JSON array, no markdown, no explanation. Each item: { "title": string, "date": string YYYY-MM-DD, "time": string HH:MM 24hr, "description": string }`,
              },
              { role: "user", content: transcript },
            ],
          }),
        }
      );

      if (!chatRes.ok) {
        const errBody = await chatRes.text();
        console.error("[transcribe] GPT API error:", chatRes.status, errBody);
        return c.json(
          {
            error: {
              message: "Event extraction failed. Please try again.",
              code: "GPT_ERROR",
            },
          },
          500
        );
      }

      const chatData = (await chatRes.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const rawContent = chatData.choices[0]?.message?.content ?? "[]";
      const events: ExtractedEvent[] = safeParseJsonArray(
        rawContent,
        extractedEventSchema
      );

      if (events.length === 0) {
        return c.json({
          data: {
            sessionId: null,
            transcript,
            events: [],
          },
        });
      }

      const session = await prisma.voiceSession.create({
        data: {
          userId: user.id,
          transcript,
          eventCount: events.length,
          durationSecs,
          timeZone: sessionTimeZone,
        },
      });

      if (events.length > 0) {
        await prisma.calendarEvent.createMany({
          data: events.map((e) => ({
            sessionId: session.id,
            userId: user.id,
            title: e.title,
            eventDate: e.date,
            eventTime: e.time,
            description: e.description ?? "",
          })),
        });
      }

      if (plan === "free" && !daysUsed.includes(today)) {
        daysUsed.push(today);
        await prisma.userProfile.update({
          where: { id: profile.id },
          data: {
            daysUsedThisWeek: JSON.stringify(daysUsed),
            weekResetAt: now,
          },
        });
      }

      let postProfile = await prisma.userProfile.findUniqueOrThrow({
        where: { userId: user.id },
      });
      postProfile = await ensureProBadgeProgressStarted(postProfile);
      await prisma.userProfile.update({
        where: { id: postProfile.id },
        data: { totalVoiceSessions: { increment: 1 } },
      });
      postProfile = await prisma.userProfile.findUniqueOrThrow({
        where: { userId: user.id },
      });

      await maybeAwardFirstPlanBadge(user.id);

      const tzForHour = sessionTimeZone ?? DEFAULT_TIME_ZONE;
      const { hour: localHour } = localHourAndMinuteInTimeZone(now, tzForHour);
      await maybeAwardEarlyRiser(postProfile, now, localHour);
      await maybeAwardProBadgesAfterTranscribe(
        postProfile,
        events.length,
        durationSecs,
        now
      );

      return c.json({ data: { sessionId: session.id, transcript, events } });
    } catch (err) {
      console.error("[transcribe] Internal error for user:", user.id, err);
      return c.json(
        {
          error: {
            message: "An unexpected error occurred. Please try again.",
            code: "INTERNAL_ERROR",
          },
        },
        500
      );
    }
  }
);
