import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { Context, MiddlewareHandler } from "hono";
import { env } from "../env.ts";
import type { SupabaseUser } from "../auth";
import { rateLimit, type RateLimitTier } from "./rateLimit";

function getRedis(): Redis | null {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

const redis = getRedis();

/** 10 requests per user per hour — OpenAI transcribe. */
export const transcribeHourlyLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "1 h"),
      prefix: "button:rl:transcribe",
    })
  : null;

/** 20 requests per user per hour — calendar add & reminder scheduling surface. */
export const calendarHourlyLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, "1 h"),
      prefix: "button:rl:calendar",
    })
  : null;

export const remindersScheduleHourlyLimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, "1 h"),
      prefix: "button:rl:reminders_sched",
    })
  : null;

function getClientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf.trim();
  return "unknown";
}

type MemHour = { timestamps: number[]; lastSeenMs: number };
const hourlyMemoryBuckets = new Map<string, MemHour>();

function checkMemHourly(key: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  let entry = hourlyMemoryBuckets.get(key) ?? { timestamps: [], lastSeenMs: now };
  const cutoff = now - windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  entry.lastSeenMs = now;
  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    hourlyMemoryBuckets.set(key, entry);
    return { allowed: false, retryAfterSeconds };
  }
  entry.timestamps.push(now);
  hourlyMemoryBuckets.set(key, entry);
  return { allowed: true, retryAfterSeconds: 0 };
}

const HOUR_MS = 3600_000;

/**
 * Per-user Upstash sliding window when Redis configured; otherwise same limits in process memory (single-instance).
 */
export function hybridUserHourlyLimit(
  limiter: Ratelimit | null,
  memoryMaxPerHour: number,
  memoryKeyPrefix: string,
  fallbackTier: RateLimitTier
): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get("user") as SupabaseUser | null;
    if (!user?.id) {
      return rateLimit(fallbackTier)(c, next);
    }

    if (limiter) {
      const { success, reset } = await limiter.limit(user.id);
      if (!success) {
        const retryAfterSeconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        c.header("Retry-After", String(retryAfterSeconds));
        return c.json(
          {
            error: {
              message: "Too many requests. Please wait and try again.",
              code: "RATE_LIMITED",
            },
          },
          429
        );
      }
      await next();
      return;
    }

    const mem = checkMemHourly(`${memoryKeyPrefix}:${user.id}`, memoryMaxPerHour, HOUR_MS);
    if (!mem.allowed) {
      c.header("Retry-After", String(mem.retryAfterSeconds));
      return c.json(
        {
          error: {
            message: "Too many requests. Please wait and try again.",
            code: "RATE_LIMITED",
          },
        },
        429
      );
    }
    await next();
  };
}

/** 5 requests per IP per 15 minutes (SMS verification endpoints). In-memory; pair with Upstash later if needed. */
const phoneIpBuckets = new Map<string, { timestamps: number[]; lastSeenMs: number }>();

export function rateLimitPhoneAuthIp(): MiddlewareHandler {
  const maxRequests = 5;
  const windowMs = 15 * 60_000;

  return async (c, next) => {
    const ip = getClientIp(c);
    const now = Date.now();
    let entry = phoneIpBuckets.get(ip);
    if (!entry) entry = { timestamps: [], lastSeenMs: now };
    const cutoff = now - windowMs;
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    entry.lastSeenMs = now;

    if (entry.timestamps.length >= maxRequests) {
      const oldest = entry.timestamps[0] ?? now;
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      c.header("Retry-After", String(retryAfterSeconds));
      return c.json(
        {
          error: {
            message: "Too many attempts from this network. Please wait and try again.",
            code: "RATE_LIMITED",
          },
        },
        429
      );
    }

    entry.timestamps.push(now);
    phoneIpBuckets.set(ip, entry);
    await next();
  };
}
