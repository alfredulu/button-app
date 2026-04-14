import type { SupabaseClient } from "@supabase/supabase-js";
import { prisma } from "../prisma";
import { env } from "../env.ts";
import type { AppleNotificationEvent } from "../lib/verifyAppleNotificationJwt";

async function findSupabaseUserIdForAppleSub(
  admin: SupabaseClient,
  appleSub: string
): Promise<string | null> {
  const bySubject = await prisma.userProfile.findUnique({
    where: { appleSubject: appleSub },
    select: { userId: true },
  });
  if (bySubject) return bySubject.userId;

  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[apple-notifications] listUsers failed:", error.message);
      return null;
    }
    for (const user of data.users) {
      for (const identity of user.identities ?? []) {
        if (identity.provider !== "apple") continue;
        const dataSub = identity.identity_data as Record<string, unknown> | undefined;
        const fromData = typeof dataSub?.sub === "string" ? dataSub.sub : null;
        const fromProvider =
          typeof (identity as { provider_id?: string }).provider_id === "string"
            ? (identity as { provider_id: string }).provider_id
            : null;
        const idField = typeof identity.identity_id === "string" ? identity.identity_id : null;
        if (fromData === appleSub || fromProvider === appleSub || idField === appleSub) {
          await prisma.userProfile
            .updateMany({
              where: { userId: user.id, appleSubject: null },
              data: { appleSubject: appleSub },
            })
            .catch(() => {});
          return user.id;
        }
      }
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function deleteAllPrismaDataForUser(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.userProfile.updateMany({
      where: { accountabilityPartnerId: userId },
      data: { accountabilityPartnerId: null },
    });
    await tx.smsReminder.deleteMany({ where: { userId } });
    await tx.voiceSession.deleteMany({ where: { userId } });
    await tx.planningDay.deleteMany({ where: { userId } });
    await tx.badge.deleteMany({ where: { userId } });
    await tx.weeklyScoreRecord.deleteMany({ where: { userId } });
    await tx.phoneVerification.deleteMany({ where: { userId } });
    await tx.twilioLog.deleteMany({ where: { userId } });
    await tx.userProfile.deleteMany({ where: { userId } });
  });
}

async function revokeAllAuthSessions(admin: SupabaseClient, userId: string): Promise<void> {
  const adminAny = admin.auth.admin as unknown as {
    signOut?: (userId: string, scope?: string) => Promise<{ error: { message: string } | null }>;
  };
  if (typeof adminAny.signOut === "function") {
    const { error } = await adminAny.signOut(userId, "global");
    if (error) console.error("[apple-notifications] auth.admin.signOut:", error.message);
    return;
  }

  const key = env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}/logout`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ scope: "global" }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error("[apple-notifications] admin logout HTTP", res.status, t);
  }
}

/**
 * Apple uses `account-deleted`; tolerate `account-delete` alias.
 */
function isAccountDeleted(type: string): boolean {
  return type === "account-deleted" || type === "account-delete";
}

export async function processAppleNotificationEvent(
  event: AppleNotificationEvent,
  admin: SupabaseClient
): Promise<void> {
  const { type, sub, email } = event;

  const userId = await findSupabaseUserIdForAppleSub(admin, sub);
  if (!userId) {
    console.warn("[apple-notifications] No user for Apple sub (acknowledged):", type);
    return;
  }

  if (isAccountDeleted(type)) {
    await deleteAllPrismaDataForUser(userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error("[apple-notifications] deleteUser:", error.message);
    return;
  }

  if (type === "consent-revoked") {
    await revokeAllAuthSessions(admin, userId);
    await prisma.userProfile.updateMany({
      where: { userId },
      data: { appleConsentRevokedAt: new Date() },
    });
    return;
  }

  if (type === "email-disabled") {
    console.log("[apple-notifications] email-disabled", { userId, email: email ?? "(none)" });
    await prisma.userProfile.updateMany({
      where: { userId },
      data: { applePrivateRelayDisabledAt: new Date() },
    });
    return;
  }

  if (type === "email-enabled") {
    console.log("[apple-notifications] email-enabled", { userId, email: email ?? "(none)" });
    await prisma.userProfile.updateMany({
      where: { userId },
      data: { applePrivateRelayDisabledAt: null },
    });
    return;
  }

  console.log("[apple-notifications] unhandled type (ignored):", type);
}
