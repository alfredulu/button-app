import { env } from "../env.ts";

type RcSubscriberResponse = {
  subscriber?: {
    entitlements?: Record<
      string,
      {
        expires_date?: string | null;
      }
    >;
  };
};

export async function fetchRevenueCatSubscriber(appUserId: string): Promise<RcSubscriberResponse | null> {
  const key = env.REVENUECAT_SECRET_API_KEY?.trim();
  if (!key) return null;

  const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    console.error("[revenuecat] subscriber fetch failed", res.status);
    return null;
  }

  return (await res.json()) as RcSubscriberResponse;
}

export function isProFromRevenueCatPayload(
  data: RcSubscriberResponse | null,
  entitlementId: string
): boolean {
  if (!data?.subscriber?.entitlements) return false;
  const ent = data.subscriber.entitlements[entitlementId];
  if (!ent) return false;
  if (!ent.expires_date) return true;
  const exp = new Date(ent.expires_date);
  return exp.getTime() > Date.now();
}
