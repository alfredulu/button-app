import { prisma } from "../prisma";
import { env } from "../env.ts";

const planCache = new Map<string, { plan: "free" | "pro"; exp: number }>();
const CACHE_TTL_MS = 60_000;

/**
 * Effective Pro status: RevenueCat REST API when REVENUECAT_SECRET_API_KEY is set (cached),
 * otherwise database `plan` (updated by RevenueCat webhooks or manual ops).
 */
export async function getEffectivePlan(userId: string): Promise<"free" | "pro"> {
  const entitlementId = env.REVENUECAT_ENTITLEMENT_PRO ?? "pro";
  const apiKey = env.REVENUECAT_SECRET_API_KEY;

  if (apiKey) {
    const hit = planCache.get(userId);
    if (hit && hit.exp > Date.now()) {
      return hit.plan;
    }

    try {
      const res = await fetch(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      if (res.ok) {
        const json = (await res.json()) as {
          subscriber?: {
            entitlements?: Record<
              string,
              { expires_date?: string | null; is_active?: boolean }
            >;
          };
        };
        const ent = json.subscriber?.entitlements?.[entitlementId];
        const now = Date.now();
        let active = ent?.is_active === true;
        if (!active && ent?.expires_date) {
          const t = new Date(ent.expires_date).getTime();
          active = !Number.isNaN(t) && t > now;
        }
        const plan: "free" | "pro" = active ? "pro" : "free";
        planCache.set(userId, { plan, exp: now + CACHE_TTL_MS });
        return plan;
      }
    } catch {
      // fall through to DB
    }
  }

  const profile = await prisma.userProfile.findUnique({ where: { userId } });
  return profile?.plan === "pro" ? "pro" : "free";
}

export function invalidatePlanCache(userId: string): void {
  planCache.delete(userId);
}
