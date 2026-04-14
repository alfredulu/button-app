/**
 * OWASP Rate Limiting Middleware
 *
 * OWASP API Security Top 10 - API4:2023 Unrestricted Resource Consumption
 * Rate limiting is a critical defense against brute force, DoS, and API abuse.
 *
 * This implementation uses a sliding window algorithm (tracking timestamps in an array)
 * which provides more accurate rate limiting compared to fixed-window counters.
 *
 * NOTE: In-memory buckets complement Upstash (`middleware/upstashLimits.ts`) for
 * route-specific limits. When UPSTASH_* env is set, Redis-backed limits apply; otherwise
 * an in-memory fallback runs for local development.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { SupabaseUser } from "../auth";

// Sliding window: store array of request timestamps per key
type WindowEntry = {
  timestamps: number[];
  lastSeenMs: number;
};

type RateLimitTier = "publicStrict" | "authStrict" | "authDefault";

/**
 * Rate limit tier definitions.
 *
 * OWASP note: Tiers are defined server-side and NEVER derived from client-controlled
 * input. Attackers cannot self-upgrade to a more permissive tier.
 *
 * - publicStrict: 20 req/min - unauthenticated endpoints (health check, public routes).
 *   Low limit prevents reconnaissance and DDoS amplification.
 *
 * - authStrict: 10 req/min per user - expensive AI endpoints (Whisper + GPT-4o).
 *   Each request costs real money; strict limit caps financial exposure per user.
 *
 * - authDefault: 60 req/min per user - standard authenticated API routes.
 *   Generous enough for normal use, but blocks scripted abuse patterns.
 */
const TIER_CONFIG: Record<RateLimitTier, { maxRequests: number; windowMs: number }> = {
  publicStrict: { maxRequests: 20, windowMs: 60_000 },
  authStrict: { maxRequests: 10, windowMs: 60_000 },
  authDefault: { maxRequests: 60, windowMs: 60_000 },
};

// Separate buckets per tier to avoid cross-tier key collisions
const ipWindows = new Map<RateLimitTier, Map<string, WindowEntry>>();
const userWindows = new Map<RateLimitTier, Map<string, WindowEntry>>();

// Initialize tier maps
for (const tier of Object.keys(TIER_CONFIG) as RateLimitTier[]) {
  ipWindows.set(tier, new Map());
  userWindows.set(tier, new Map());
}

// Auto-cleanup stale entries every 5 minutes to prevent memory leaks
// OWASP: Unbounded memory growth can itself become a DoS vector
let lastCleanupMs = 0;
const CLEANUP_INTERVAL_MS = 5 * 60_000;
const STALE_ENTRY_TTL_MS = 2 * 60_000; // entries not seen in 2 min are eligible for GC

function cleanupStaleEntries(): void {
  const now = Date.now();
  if (now - lastCleanupMs < CLEANUP_INTERVAL_MS) return;
  lastCleanupMs = now;

  for (const bucketMap of ipWindows.values()) {
    for (const [key, entry] of bucketMap) {
      if (now - entry.lastSeenMs > STALE_ENTRY_TTL_MS) {
        bucketMap.delete(key);
      }
    }
  }
  for (const bucketMap of userWindows.values()) {
    for (const [key, entry] of bucketMap) {
      if (now - entry.lastSeenMs > STALE_ENTRY_TTL_MS) {
        bucketMap.delete(key);
      }
    }
  }
}

/**
 * Sliding window check: count requests within the last windowMs milliseconds.
 * Returns { allowed, retryAfterSeconds }.
 */
function checkWindow(
  bucketMap: Map<string, WindowEntry>,
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const existing = bucketMap.get(key);
  const entry: WindowEntry = existing ?? { timestamps: [], lastSeenMs: now };

  // Evict timestamps older than the window
  const cutoff = now - windowMs;
  entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);
  entry.lastSeenMs = now;

  if (entry.timestamps.length >= maxRequests) {
    // Retry after the oldest timestamp in the window expires
    const oldestTs = entry.timestamps[0] ?? now;
    const retryAfterMs = oldestTs + windowMs - now;
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    bucketMap.set(key, entry);
    return { allowed: false, retryAfterSeconds };
  }

  entry.timestamps.push(now);
  bucketMap.set(key, entry);
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Extract the client IP address from standard proxy headers.
 *
 * OWASP: Use x-forwarded-for (leftmost entry = original client) or
 * cf-connecting-ip (Cloudflare). Never trust a single header blindly in
 * multi-hop proxy setups; take the leftmost entry to get closest-to-client IP.
 */
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

/**
 * Rate limiter middleware factory.
 *
 * Usage:
 *   router.post("/", rateLimit("authStrict"), async (c) => { ... })
 *
 * For IP-only tiers (publicStrict): checks IP only.
 * For user tiers (authStrict, authDefault): checks IP first (cheaper), then user ID.
 * Checking IP first short-circuits before hitting the per-user check, which is the
 * correct order to minimize work when blocking known-bad IPs.
 */
export function rateLimit(tier: RateLimitTier): MiddlewareHandler {
  return async (c, next) => {
    // Periodic GC - runs at most once per CLEANUP_INTERVAL_MS
    cleanupStaleEntries();

    const { maxRequests, windowMs } = TIER_CONFIG[tier];
    const ip = getClientIp(c);

    if (tier === "publicStrict") {
      // OWASP: Public endpoints get IP-based limits; if a user is present (e.g. optional auth),
      // also apply a per-user limit to prevent abuse via IP rotation.
      const ipBucketMap = ipWindows.get(tier)!;
      const result = checkWindow(ipBucketMap, `ip:${ip}`, maxRequests, windowMs);
      if (!result.allowed) {
        c.header("Retry-After", String(result.retryAfterSeconds));
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

      const user = c.get("user") as SupabaseUser | null;
      if (user?.id) {
        const userBucketMap = userWindows.get(tier)!;
        const userResult = checkWindow(userBucketMap, `user:${user.id}`, maxRequests, windowMs);
        if (!userResult.allowed) {
          c.header("Retry-After", String(userResult.retryAfterSeconds));
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
      }
    } else {
      // Authenticated tiers: check IP first (cheaper), then per-user
      // OWASP: IP limits catch credential-stuffing from a single source;
      // user limits cap per-account abuse regardless of IP rotation.
      const ipBucketMap = ipWindows.get(tier)!;
      const ipResult = checkWindow(
        ipBucketMap,
        `ip:${ip}`,
        // IP limit is 3x the user limit for auth tiers - allows multiple users from same NAT
        maxRequests * 3,
        windowMs
      );
      if (!ipResult.allowed) {
        c.header("Retry-After", String(ipResult.retryAfterSeconds));
        return c.json(
          {
            error: {
              message: "Too many requests from your network. Please wait and try again.",
              code: "RATE_LIMITED",
            },
          },
          429
        );
      }

      // Per-user rate limit (requires user to be set in context by auth middleware)
      const user = c.get("user") as SupabaseUser | null;
      if (user?.id) {
        const userBucketMap = userWindows.get(tier)!;
        const userResult = checkWindow(userBucketMap, `user:${user.id}`, maxRequests, windowMs);
        if (!userResult.allowed) {
          c.header("Retry-After", String(userResult.retryAfterSeconds));
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
      }
    }

    await next();
  };
}

