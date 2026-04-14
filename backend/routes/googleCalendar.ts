import { Hono } from "hono";
import { createHmac, randomBytes } from "crypto";
import { prisma } from "../prisma";
import { env } from "../env.ts";
import type { SupabaseUser } from "../auth";
import { rateLimit } from "../middleware/rateLimit";
import { calendarHourlyLimit, hybridUserHourlyLimit } from "../middleware/redisRateLimits";
import { validateBody } from "../middleware/validation";
import { ensureProfile } from "../services/googleCalendarTokens";
import {
  calendarAddBodySchema,
  addEventsViaGoogleCalendar,
  runPostCalendarAddHooks,
} from "../services/calendarAdd";
import { DEFAULT_TIME_ZONE } from "../lib/zonedTime";

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function base64UrlEncode(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signState(payloadB64: string): string {
  const secret = env.GOOGLE_CLIENT_SECRET ?? env.BETTER_AUTH_SECRET ?? "dev-secret";
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function makeState(userId: string): string {
  const payload = {
    userId,
    ts: Date.now(),
    nonce: randomBytes(16).toString("hex"),
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = signState(payloadB64);
  return `${payloadB64}.${sig}`;
}

function verifyAndParseState(state: string): { userId: string } | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;
  const expected = signState(payloadB64);
  if (sig !== expected) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(payloadB64)) as { userId?: string; ts?: number };
    if (!parsed.userId || typeof parsed.userId !== "string") return null;
    if (typeof parsed.ts === "number" && Date.now() - parsed.ts > 10 * 60_000) return null;
    return { userId: parsed.userId };
  } catch {
    return null;
  }
}

export const googleCalendarRouter = new Hono<{ Variables: { user: SupabaseUser | null } }>();

googleCalendarRouter.get("/status", rateLimit("authDefault"), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const profile = await ensureProfile(user.id);
  const connected = Boolean(profile.googleRefreshToken);
  return c.json({ data: { connected } });
});

googleCalendarRouter.get("/auth-url", rateLimit("authDefault"), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return c.json(
      {
        error: {
          message: "Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
          code: "NOT_CONFIGURED",
        },
      },
      503
    );
  }

  const redirectUri = `${env.BACKEND_URL.replace(/\/$/, "")}/api/google-calendar/callback`;
  const state = makeState(user.id);

  const url = new URL(GOOGLE_AUTH_BASE);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.events");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return c.json({ data: { url: url.toString() } });
});

googleCalendarRouter.get("/callback", rateLimit("publicStrict"), async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    const deepLink = `vibecode://google-calendar?success=0&error=${encodeURIComponent(error)}`;
    return c.redirect(deepLink, 302);
  }

  if (!code || !state) {
    const deepLink = "vibecode://google-calendar?success=0&error=missing_code_or_state";
    return c.redirect(deepLink, 302);
  }

  const parsed = verifyAndParseState(state);
  if (!parsed) {
    const deepLink = "vibecode://google-calendar?success=0&error=invalid_state";
    return c.redirect(deepLink, 302);
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    const deepLink = "vibecode://google-calendar?success=0&error=not_configured";
    return c.redirect(deepLink, 302);
  }

  const redirectUri = `${env.BACKEND_URL.replace(/\/$/, "")}/api/google-calendar/callback`;
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("[google-calendar] token exchange error", tokenRes.status, body);
    const deepLink = "vibecode://google-calendar?success=0&error=token_exchange_failed";
    return c.redirect(deepLink, 302);
  }

  const tokenData = (await tokenRes.json()) as TokenResponse;
  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000);

  const profile = await ensureProfile(parsed.userId);
  await prisma.userProfile.update({
    where: { id: profile.id },
    data: {
      googleAccessToken: tokenData.access_token,
      googleTokenExpiresAt: expiresAt,
      googleRefreshToken: tokenData.refresh_token ?? profile.googleRefreshToken,
    },
  });

  const deepLink = "vibecode://google-calendar?success=1";
  return c.redirect(deepLink, 302);
});

googleCalendarRouter.post("/disconnect", rateLimit("authDefault"), async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

  const profile = await ensureProfile(user.id);
  await prisma.userProfile.update({
    where: { id: profile.id },
    data: {
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiresAt: null,
    },
  });

  return c.json({ data: { connected: false } });
});

googleCalendarRouter.post(
  "/add-events",
  hybridUserHourlyLimit(calendarHourlyLimit, 20, "rl:cal", "authStrict"),
  rateLimit("authStrict"),
  validateBody(calendarAddBodySchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

    const body = c.req.valid("json");
    const timeZone = body.timeZone ?? DEFAULT_TIME_ZONE;

    try {
      const { created } = await addEventsViaGoogleCalendar(user.id, body);
      await runPostCalendarAddHooks(user.id, created, timeZone);
      return c.json({ data: { created } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "NOT_CONNECTED") {
        return c.json(
          { error: { message: "Google Calendar is not connected.", code: "NOT_CONNECTED" } },
          403
        );
      }
      if (msg === "GOOGLE_API_ERROR") {
        return c.json(
          { error: { message: "Could not add events to Google Calendar.", code: "GOOGLE_API_ERROR" } },
          502
        );
      }
      throw e;
    }
  }
);
