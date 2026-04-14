/**
 * Transcribe Route - Audio to Calendar Events
 *
 * Security hardening applied per OWASP API Security Top 10.
 */

import { Hono } from "hono";
import { prisma } from "../prisma";
import { env } from "../env.ts";
import type { SupabaseUser } from "../auth";
import { rateLimit } from "../middleware/rateLimit";
import {
  ALLOWED_AUDIO_MIME_TYPES,
  MAX_AUDIO_SIZE_BYTES,
  safeParseJsonArray,
  extractedEventSchema,
  type ExtractedEvent,
} from "../middleware/validation";

export const transcribeRouter = new Hono<{
  Variables: {
    user: SupabaseUser | null;
  };
}>();

transcribeRouter.post(
  "/",
  // OWASP API4:2023 Unrestricted Resource Consumption - each request costs OpenAI money.
  // 10 req/min per user caps financial exposure from compromised or abusive accounts.
  rateLimit("authStrict"),
  async (c) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
    }

    // Plan enforcement
    let profile = await prisma.userProfile.findUnique({ where: { userId: user.id } });
    if (!profile) {
      profile = await prisma.userProfile.create({ data: { userId: user.id } });
    }

    const now = new Date();
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    lastMonday.setHours(0, 0, 0, 0);

    // OWASP: Wrap JSON.parse in try-catch - malformed DB data must not crash the server
    let daysUsed: string[];
    try {
      daysUsed = JSON.parse(profile.daysUsedThisWeek || "[]") as string[];
      if (!Array.isArray(daysUsed)) daysUsed = [];
    } catch {
      // OWASP: Log the anomaly server-side for audit, recover gracefully
      console.error("[transcribe] Failed to parse daysUsedThisWeek for user:", user.id);
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
    if (
      profile.plan === "free" &&
      !daysUsed.includes(today) &&
      daysUsed.length >= 3
    ) {
      return c.json(
        {
          error: {
            message: "You've used all 3 free days this week. Upgrade to Pro for unlimited access.",
            code: "PLAN_LIMIT",
          },
        },
        403
      );
    }

    // Check OpenAI API key
    const openaiKey = env.OPENAI_API_KEY;
    if (!openaiKey) {
      return c.json(
        {
          error: {
            message: "AI service not configured. Please add your OPENAI_API_KEY.",
            code: "NO_API_KEY",
          },
        },
        503
      );
    }

    // Get audio from form data
    const formData = await c.req.formData();
    const audioFile = formData.get("audio") as File | null;
    if (!audioFile) {
      return c.json({ error: { message: "No audio file provided", code: "NO_AUDIO" } }, 400);
    }

    // OWASP: Whitelist MIME type validation - reject files that are not known audio formats.
    // This prevents upload of arbitrary file types that could be used for injection or
    // server-side processing attacks.
    if (!(ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(audioFile.type)) {
      return c.json(
        {
          error: {
            message: `Unsupported audio format. Allowed types: ${ALLOWED_AUDIO_MIME_TYPES.join(", ")}`,
            code: "INVALID_AUDIO_TYPE",
          },
        },
        400
      );
    }

    // OWASP: Server-side file size check prevents memory exhaustion.
    // Client-side size checks are trivially bypassed; always enforce on the server.
    if (audioFile.size > MAX_AUDIO_SIZE_BYTES) {
      return c.json(
        {
          error: {
            message: `Audio file too large. Maximum size is ${MAX_AUDIO_SIZE_BYTES / (1024 * 1024)}MB`,
            code: "FILE_TOO_LARGE",
          },
        },
        400
      );
    }

    try {
      // Step 1: Transcribe with Whisper
      const whisperForm = new FormData();
      whisperForm.append("file", audioFile);
      whisperForm.append("model", "whisper-1");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}` },
        body: whisperForm,
      });

      if (!whisperRes.ok) {
        // OWASP API8:2023 Security Misconfiguration - NEVER expose raw upstream error bodies
        // to clients. They may contain internal details about API keys, rate limits, or
        // service internals that aid attackers.
        const errBody = await whisperRes.text();
        console.error("[transcribe] Whisper API error:", whisperRes.status, errBody);
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

      // Step 2: Extract events with GPT-4o
      const chatRes = await fetch("https://api.openai.com/v1/chat/completions", {
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
      });

      if (!chatRes.ok) {
        // OWASP: Log upstream error details server-side, return generic message to client
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

      // OWASP: Validate GPT output against a strict Zod schema before using it.
      // LLM output is untrusted input - it could contain unexpected shapes, injected
      // strings, or malformed data. Filter out events that don't meet the schema.
      const events: ExtractedEvent[] = safeParseJsonArray(rawContent, extractedEventSchema);

      // Save VoiceSession
      const session = await prisma.voiceSession.create({
        data: {
          userId: user.id,
          transcript,
          eventCount: events.length,
          durationSecs: 0,
        },
      });

      // Save CalendarEvents
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

      // Update UserProfile: add today to daysUsedThisWeek if not already there
      if (!daysUsed.includes(today)) {
        daysUsed.push(today);
        await prisma.userProfile.update({
          where: { id: profile.id },
          data: { daysUsedThisWeek: JSON.stringify(daysUsed), weekResetAt: now },
        });
      }

      return c.json({ data: { sessionId: session.id, transcript, events } });
    } catch (err) {
      // OWASP: Log full error server-side but return a generic message to the client.
      // Stack traces and internal error messages must never be exposed externally.
      console.error("[transcribe] Internal error for user:", user.id, err);
      return c.json(
        { error: { message: "An unexpected error occurred. Please try again.", code: "INTERNAL_ERROR" } },
        500
      );
    }
  }
);
