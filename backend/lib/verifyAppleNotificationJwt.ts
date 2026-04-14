import * as jose from "jose";

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS = jose.createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export type AppleNotificationEvent = {
  type: string;
  sub: string;
  email?: string;
  event_time?: number;
};

function normalizeEvent(raw: Record<string, unknown>): AppleNotificationEvent | null {
  const type = raw.type;
  const sub = raw.sub;
  if (typeof type !== "string" || typeof sub !== "string" || !sub) return null;
  const email = raw.email;
  const event_time = raw.event_time;
  return {
    type,
    sub,
    email: typeof email === "string" ? email : undefined,
    event_time: typeof event_time === "number" ? event_time : undefined,
  };
}

/**
 * Apple may send `events` as a single object { type, sub, ... } or as a map of event-id → payload.
 */
function parseEventsClaim(eventsUnknown: unknown): AppleNotificationEvent[] {
  if (!eventsUnknown || typeof eventsUnknown !== "object") return [];
  const root = eventsUnknown as Record<string, unknown>;
  const single = normalizeEvent(root);
  if (single) return [single];
  const out: AppleNotificationEvent[] = [];
  for (const v of Object.values(root)) {
    if (v && typeof v === "object") {
      const e = normalizeEvent(v as Record<string, unknown>);
      if (e) out.push(e);
    }
  }
  return out;
}

/**
 * Verify Apple’s JWS and return parsed events. Throws if signature/issuer/audience invalid.
 */
export async function verifyAppleNotificationPayload(
  compactJws: string,
  audience: string
): Promise<AppleNotificationEvent[]> {
  const { payload } = await jose.jwtVerify(compactJws, APPLE_JWKS, {
    issuer: APPLE_ISSUER,
    audience,
  });
  return parseEventsClaim(payload.events);
}
