import * as jose from "jose";

const APPLE_ISSUER = "https://appleid.apple.com";
const JWKS = jose.createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export type AppleNotificationEvent = {
  type: string;
  sub: string;
  email?: string;
  event_time?: number;
};

/**
 * Verify Sign in with Apple server-to-server notification JWS per Apple documentation.
 * @see https://developer.apple.com/documentation/sign_in_with_apple/processing_changes_for_sign_in_with_apple_accounts
 */
export async function verifyAppleServerNotificationJwt(
  compactJws: string,
  audience: string
): Promise<AppleNotificationEvent | null> {
  try {
    const { payload } = await jose.jwtVerify(compactJws, JWKS, {
      issuer: APPLE_ISSUER,
      audience,
    });

    const events = payload.events;
    if (!events || typeof events !== "object" || Array.isArray(events)) {
      return null;
    }

    const o = events as Record<string, unknown>;
    const type = o.type;
    const sub = o.sub;
    if (typeof type !== "string" || typeof sub !== "string" || sub.length === 0) {
      return null;
    }

    return {
      type,
      sub,
      email: typeof o.email === "string" ? o.email : undefined,
      event_time: typeof o.event_time === "number" ? o.event_time : undefined,
    };
  } catch (e) {
    console.error("[apple-notifications] JWT verification failed");
    return null;
  }
}
