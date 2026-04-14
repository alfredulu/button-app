# Security checklist (Button API)

This document maps the launch security requirements to **what the server implements** vs **what you must configure in dashboards**.

## Implemented in this codebase

- **Voice / OpenAI (server):** Max **10** voice sessions per user per **UTC day**, **50** per **UTC month**; **10MB** audio cap; allowed MIME types; **≥1s** duration; **429** with exact message *"Daily limit reached. Try again tomorrow."* when the daily cap is hit; monthly cap returns *"Monthly limit reached. Try again next month."*
- **Twilio (server):** Max **5 successful SMS** per user per UTC day; **20 successful SMS** same day → `smsFlagged`, `smsBlockedAt`, optional Resend alert; **every attempt** logged in `TwilioLog`; phone verify codes **hashed** (scrypt + salt), **6 digits**, **10 min** expiry, max **3** wrong attempts then lockout; max **3 successful verification SMS** to the **same E.164 number** per rolling hour.
- **RevenueCat:** Webhook at `POST /api/webhooks/revenuecat` — **403** if `Authorization` is not `Bearer <REVENUECAT_WEBHOOK_SECRET>` (or exact secret); subscriber refreshed via API; `getEffectivePlan()` syncs DB and is used for plan-sensitive routes.
- **Twilio webhook:** `POST /api/reminders/webhook` validates **X-Twilio-Signature**; **403** on failure.
- **Rate limits:** **Upstash Redis** when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set — `/api/transcribe` **10/hour/user**, `/api/calendar/add` and `/api/google-calendar/add-events` **20/hour/user**, `/api/reminders/schedule` **20/hour/user**, **5/IP/15min** on Google OAuth **callback** and phone **send-code** / **verify**. In-memory fallback if Upstash is unset (local dev only).
- **Auth:** Protected routes require valid **Supabase JWT**; `user_id` from token only, not body.
- **Input:** User text sanitized (HTML/script stripped), **500** char cap on key fields; Prisma only (no raw string SQL).
- **Indexes:** `userId` (and reminder composite) on Prisma models as in `schema.prisma`.
- **Weekly digest:** `GET /internal/weekly-digest` with `Authorization: Bearer <CRON_SECRET>` — emails summary via Resend when configured.
- **Sign in with Apple (server-to-server):** `POST /api/auth/apple/notifications` — body `{ "payload": "<JWS>" }`. JWT signature verified with Apple’s JWKS; invalid/missing signature → **403**. Requires **`SUPABASE_SERVICE_ROLE_KEY`**. Handles **`account-deleted`** (Apple’s name; `account-delete` alias), **`consent-revoked`**, **`email-disabled`** / **`email-enabled`**. Resolves users by `UserProfile.appleSubject` or Supabase Auth identities (apple `sub`).
- **Secrets:** Never commit `.env` (see `.gitignore`). Use Render / dashboard env for production.

## Configure manually (not in code)

- **OpenAI:** Hard cap **$100/mo**, alert **$40** → justin@getbuttonapp.com.
- **Twilio:** Hard cap **$50/mo**, alert **$20** → justin@getbuttonapp.com.
- **Supabase:** Storage alert at **400MB** (dashboard); **raw audio** is not stored by this API path (multipart goes straight to OpenAI) — confirm the mobile app does not upload audio to Supabase Storage.
- **RLS:** Application data lives in the **Postgres database** used by Prisma (e.g. Render Postgres), **not** as rows in Supabase Postgres. **Supabase RLS** applies to tables in the Supabase project. To use RLS as in the original checklist, either mirror critical tables into Supabase with policies, or treat **JWT + server-side `userId` filters** as the access model for this API (current design).
- **npm audit / git history:** Run locally/CI; rotate any leaked secrets.
- **Render / Vercel alerts:** Configure **500**-rate and uptime alerts on the hosting you use (API is on **Render** in current setup).

## Environment variables (production)

Required for core auth: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BACKEND_URL`.

Strongly recommended for the checklist: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_ENTITLEMENT_PRO`, `OPENAI_API_KEY`, Twilio vars, `CRON_SECRET` (weekly job), `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SECURITY_ALERT_EMAIL`.

**Sign in with Apple notifications:** `SUPABASE_SERVICE_ROLE_KEY` (service role — server only); optional `APPLE_NOTIFICATIONS_AUDIENCE` (defaults to `com.buttontech.button`, must match JWT `aud` from Apple).
