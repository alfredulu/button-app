/**
 * Input Validation Middleware & Schemas
 *
 * OWASP API Security Top 10 - API1:2023 Broken Object Level Authorization
 * and API3:2023 Broken Object Property Level Authorization.
 *
 * All user-supplied input must be validated against strict schemas before use.
 * Never trust client-provided data - validate type, format, size, and range.
 */

import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import { stripHtmlAndScripts } from "../lib/stripHtml";

// NOTE: Never log env values - they contain secrets

/**
 * OWASP: Whitelist-based MIME type validation for audio uploads.
 * Rejecting unknown MIME types prevents attackers from uploading arbitrary files
 * disguised as audio (e.g. polyglot files, server-side scripts).
 *
 * The actual content-type is still verified server-side; do not rely solely on
 * client-supplied headers.
 */
export const ALLOWED_AUDIO_MIME_TYPES = [
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  // Some clients send these variants
  "audio/x-m4a",
  "audio/x-wav",
  "video/mp4", // Some mobile recorders use video/mp4 container for audio
] as const;

/** 10 MB — hard cap before OpenAI; aligns with financial abuse limits */
export const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Pagination query params schema.
 *
 * OWASP: Unbounded list queries can cause DoS via database overload.
 * Enforcing max limit prevents "limit=999999" style attacks.
 */
export const paginationSchema = z
  .object({
    limit: z
      .string()
      .optional()
      .transform((v) => (v !== undefined ? parseInt(v, 10) : 50))
      .pipe(
        z.number().int().min(1, { message: "limit must be at least 1" }).max(100, {
          message: "limit must be at most 100",
        })
      ),
    offset: z
      .string()
      .optional()
      .transform((v) => (v !== undefined ? parseInt(v, 10) : 0))
      .pipe(z.number().int().min(0, { message: "offset must be non-negative" })),
  })
  .strict();

/**
 * Sessions list query params - more restrictive limit for this endpoint.
 */
export const sessionsQuerySchema = z
  .object({
    limit: z
      .string()
      .optional()
      .transform((v) => (v !== undefined ? parseInt(v, 10) : 50))
      .pipe(
        z.number().int().min(1, { message: "limit must be at least 1" }).max(50, {
          message: "limit must be at most 50",
        })
      ),
  })
  .strict();

/**
 * Zod schema for GPT-extracted calendar events.
 *
 * OWASP: Never trust LLM output as structured data without validation.
 * Malformed GPT responses (injection attempts, missing fields) must be filtered
 * before persisting to the database.
 */
export const extractedEventSchema = z
  .object({
    title: z
      .string()
      .transform((v) => stripHtmlAndScripts(v.trim()))
      .pipe(z.string().min(1).max(500)),
    date: z
      .string()
      .transform((v) => v.trim())
      .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD format")),
    time: z
      .string()
      .transform((v) => v.trim())
      .pipe(z.string().regex(/^\d{2}:\d{2}$/, "time must be HH:MM format")),
    description: z
      .string()
      .transform((v) => stripHtmlAndScripts(v.trim()))
      .pipe(z.string().max(500))
      .optional()
      .default(""),
  })
  .strict();

export type ExtractedEvent = z.infer<typeof extractedEventSchema>;

/**
 * Safely parse a JSON array against an item schema, filtering out invalid items.
 */
export function safeParseJsonArray<T>(str: string, itemSchema: z.ZodType<T>): T[] {
  try {
    const parsed: unknown = JSON.parse(str);
    if (!Array.isArray(parsed)) return [];
    const results: T[] = [];
    for (const item of parsed) {
      const result = itemSchema.safeParse(item);
      if (result.success) {
        results.push(result.data);
      } else {
        // OWASP: Log malformed items server-side for security auditing, do NOT surface to client
        console.error("[validation] Filtered malformed item from LLM output:", result.error.issues);
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Helper to create a validated query middleware using @hono/zod-validator.
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return zValidator("query" as keyof ValidationTargets, schema);
}

/**
 * Helper to create a validated body middleware using @hono/zod-validator.
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return zValidator("json" as keyof ValidationTargets, schema);
}

