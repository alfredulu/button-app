import { prisma } from "../prisma";
import { env } from "../env.ts";
import { fetchRevenueCatSubscriber, isProFromRevenueCatPayload } from "./revenueCat";

const planCache = new Map<string, { plan: "free" | "pro"; at: number }>();
const CACHE_MS = 60_000;

/**
 * Effective plan for API authorization: DB is updated by RevenueCat webhooks;
 * when REVENUECAT_SECRET_API_KEY is set, reconcile from RevenueCat at most once per minute per user.
 */
export async function getEffectivePlan(userId: string): Promise<"free" | "pro"> {
  let profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile) {
    profile = await prisma.userProfile.create({ data: { userId } });
  }

  const ent = env.REVENUECAT_ENTITLEMENT_PRO?.trim();
  const apiKey = env.REVENUECAT_SECRET_API_KEY?.trim();
  if (!apiKey || !ent) {
    return profile.plan === "pro" ? "pro" : "free";
  }

  const cached = planCache.get(userId);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) {
    return cached.plan;
  }

  const rc = await fetchRevenueCatSubscriber(userId);
  if (rc === null) {
    const fallback = profile.plan === "pro" ? "pro" : "free";
    planCache.set(userId, { plan: fallback, at: now });
    return fallback;
  }

  const livePro = isProFromRevenueCatPayload(rc, ent);
  const next: "free" | "pro" = livePro ? "pro" : "free";

  if (profile.plan !== next) {
    await prisma.userProfile.update({
      where: { id: profile.id },
      data: { plan: next },
    });
  }

  planCache.set(userId, { plan: next, at: now });
  return next;
}

export async function applyRevenueCatWebhookPlan(userId: string, isPro: boolean): Promise<void> {
  const plan = isPro ? "pro" : "free";
  await prisma.userProfile.upsert({
    where: { userId },
    create: { userId, plan },
    update: { plan },
  });
  planCache.set(userId, { plan, at: Date.now() });
}
