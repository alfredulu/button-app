import type { Context, MiddlewareHandler } from "hono";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import type { SupabaseUser } from "../auth";
import { env } from "../env.ts";

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

type MemEntry = { ts: number[]; last: number };

function memSlidingWindow(
  store: Map<string, MemEntry>,
  key: string,
  max: number,
  windowMs: number
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = store.get(key) ?? { ts: [], last: now };
  const cutoff = now - windowMs;
  entry.ts = entry.ts.filter((t) => t > cutoff);
  entry.last = now;
  if (entry.ts.length >= max) {
    const oldest = entry.ts[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    store.set(key, entry);
    return { ok: false, retryAfter };
  }
  entry.ts.push(now);
  store.set(key, entry);
  return { ok: true, retryAfter: 0 };
}

const memTranscribe = new Map<string, MemEntry>();
const memCalendar = new Map<string, MemEntry>();
const memReminders = new Map<string, MemEntry>();
const memAuthIp = new Map<string, MemEntry>();

let redisClient: Redis | null = null;
function getRedis(): Redis | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  if (!redisClient) redisClient = new Redis({ url, token });
  return redisClient;
}

const rlCache = new Map<string, Ratelimit>();

function ratelimitFor(prefix: string, max: number, window: "1 h" | "15 m"): Ratelimit {
  const r = getRedis()!;
  const key = `${prefix}:${max}:${window}`;
  let existing = rlCache.get(key);
  if (!existing) {
    existing = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(max, window),
      prefix: `button:${prefix}`,
    });
    rlCache.set(key, existing);
  }
  return existing;
}

async function denyUserHour(
  c: Context,
  userId: string,
  prefix: string,
  max: number,
  memStore: Map<string, MemEntry>
): Promise<Response | null> {
  const r = getRedis();
  if (r) {
    const lim = ratelimitFor(prefix, max, "1 h");
    const { success, reset } = await lim.limit(userId);
    if (!success) {
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      c.header("Retry-After", String(retryAfter));
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
    return null;
  }

  const { ok, retryAfter } = memSlidingWindow(memStore, `${prefix}:${userId}`, max, 3_600_000);
  if (!ok) {
    c.header("Retry-After", String(retryAfter));
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
  return null;
}

/** 10 req / user / hour — /api/transcribe */
export const upstashTranscribeLimit: MiddlewareHandler = async (c, next) => {
  const user = c.get("user") as SupabaseUser | null;
  if (user?.id) {
    const denied = await denyUserHour(c, user.id, "transcribe", 10, memTranscribe);
    if (denied) return denied;
  }
  await next();
};

/** 20 req / user / hour — calendar add */
export const upstashCalendarAddLimit: MiddlewareHandler = async (c, next) => {
  const user = c.get("user") as SupabaseUser | null;
  if (user?.id) {
    const denied = await denyUserHour(c, user.id, "calendar_add", 20, memCalendar);
    if (denied) return denied;
  }
  await next();
};

/** 20 req / user / hour — reminders schedule */
export const upstashRemindersScheduleLimit: MiddlewareHandler = async (c, next) => {
  const user = c.get("user") as SupabaseUser | null;
  if (user?.id) {
    const denied = await denyUserHour(c, user.id, "reminders_schedule", 20, memReminders);
    if (denied) return denied;
  }
  await next();
};

/** 5 req / IP / 15 min */
export const upstashAuthIpLimit: MiddlewareHandler = async (c, next) => {
  const ip = getClientIp(c);
  const r = getRedis();
  if (r) {
    const lim = ratelimitFor("auth_ip", 5, "15 m");
    const { success, reset } = await lim.limit(ip);
    if (!success) {
      const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
      c.header("Retry-After", String(retryAfter));
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
    await next();
    return;
  }

  const { ok, retryAfter } = memSlidingWindow(memAuthIp, `auth:${ip}`, 5, 15 * 60_000);
  if (!ok) {
    c.header("Retry-After", String(retryAfter));
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
  await next();
};
