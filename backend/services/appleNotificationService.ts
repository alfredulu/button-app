import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env.ts";
import { prisma } from "../prisma";
import type { AppleNotificationEvent } from "../lib/verifyAppleNotificationJwt";
import { getSupabaseAdmin } from "../lib/supabaseAdmin";

function appleSubFromAuthUser(user: {
  identities?: Array<{
    provider: string;
    identity_data?: Record<string, unknown>;
    provider_id?: string;
    identity_id?: string;
  }>;
}): string | null {
  for (const ident of user.identities ?? []) {
    if (ident.provider !== "apple") continue;
    const data = ident.identity_data;
    const sub = data?.sub;
    if (typeof sub === "string" && sub) return sub;
    if (typeof ident.provider_id === "string" && ident.provider_id) return ident.provider_id;
    if (typeof ident.identity_id === "string" && ident.identity_id) return ident.identity_id;
  }
  return null;
}

async function resolveUserIdByAppleSub(admin: SupabaseClient, appleSub: string): Promise<string | null> {
  const profile = await prisma.userProfile.findUnique({
    where: { appleSubject: appleSub },
    select: { userId: true },
  });
  if (profile) return profile.userId;

  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[apple-notification] listUsers failed:", error.message);
      return null;
    }
    const users = data.users ?? [];
    for (const u of users) {
      if (appleSubFromAuthUser(u) === appleSub) return u.id;
    }
    if (users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function revokeAllSessions(admin: SupabaseClient, userId: string): Promise<void> {
  const url = env.SUPABASE_URL!.replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const res = await fetch(`${url}/auth/v1/admin/users/${userId}/logout`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scope: "global" }),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    console.error("[apple-notification] admin logout HTTP", res.status, text);
  }
  try {
    const adminApi = admin.auth.admin as unknown as {
      signOut?: (uid: string, scope: string) => Promise<{ error: Error | null }>;
    };
    if (typeof adminApi.signOut === "function") {
      const { error } = await adminApi.signOut(userId, "global");
      if (error) console.error("[apple-notification] admin.signOut:", error.message);
    }
  } catch {
    // Older clients may not expose signOut; REST above is enough when supported.
  }
}

async function deleteUserAndAppData(userId: string, admin: SupabaseClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.smsReminder.deleteMany({ where: { userId } });
    await tx.voiceSession.deleteMany({ where: { userId } });
    await tx.planningDay.deleteMany({ where: { userId } });
    await tx.phoneVerification.deleteMany({ where: { userId } });
    await tx.twilioLog.deleteMany({ where: { userId } });
    await tx.badge.deleteMany({ where: { userId } });
    await tx.weeklyScoreRecord.deleteMany({ where: { userId } });
    await tx.userProfile.updateMany({
      where: { accountabilityPartnerId: userId },
      data: { accountabilityPartnerId: null },
    });
    await tx.userProfile.deleteMany({ where: { userId } });
  });

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
}

export async function processAppleNotificationEvent(event: AppleNotificationEvent): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");

  const userId = await resolveUserIdByAppleSub(admin, event.sub);
  if (!userId) {
    console.warn("[apple-notification] no user for Apple sub; skipping", event.type, event.sub);
    return;
  }

  const t = event.type;
  if (t === "account-deleted" || t === "account-delete") {
    await deleteUserAndAppData(userId, admin);
    return;
  }
  if (t === "consent-revoked") {
    await revokeAllSessions(admin, userId);
    await prisma.userProfile.updateMany({
      where: { userId },
      data: { appleConsentRevokedAt: new Date() },
    });
    return;
  }
  if (t === "email-disabled") {
    console.log("[apple-notification] email-disabled", { userId, sub: event.sub });
    await prisma.userProfile.updateMany({
      where: { userId },
      data: { applePrivateRelayDisabledAt: new Date() },
    });
    return;
  }
  if (t === "email-enabled") {
    console.log("[apple-notification] email-enabled", { userId, sub: event.sub });
    await prisma.userProfile.updateMany({
      where: { userId },
      data: { applePrivateRelayDisabledAt: null },
    });
    return;
  }

  console.log("[apple-notification] unhandled event type", t, event.sub);
}
