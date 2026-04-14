import { prisma } from "../prisma";
import { env } from "../env.ts";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function ensureProfile(userId: string) {
  let profile = await prisma.userProfile.findUnique({ where: { userId } });
  if (!profile) profile = await prisma.userProfile.create({ data: { userId } });
  return profile;
}

export async function refreshAccessTokenIfNeeded(userId: string): Promise<string | null> {
  const profile = await ensureProfile(userId);
  if (!profile.googleRefreshToken) return null;
  const expiresAt = profile.googleTokenExpiresAt ? new Date(profile.googleTokenExpiresAt).getTime() : 0;
  const stillValid = profile.googleAccessToken && expiresAt - Date.now() > 60_000;
  if (stillValid) return profile.googleAccessToken;

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: profile.googleRefreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("[google-calendar] refresh token error", res.status, body);
    return null;
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000);

  await prisma.userProfile.update({
    where: { id: profile.id },
    data: {
      googleAccessToken: data.access_token,
      googleTokenExpiresAt: newExpiresAt,
    },
  });

  return data.access_token;
}
