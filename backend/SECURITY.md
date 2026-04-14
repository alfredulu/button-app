# Security operations (pre-launch)

## You configure in vendor dashboards (not in this repo)

- **OpenAI:** Billing → hard limit **$100/mo**, email alert **$40** → `justin@getbuttonapp.com`.
- **Twilio:** Spend cap **$50/mo**, alert **$20** → same email.
- **Supabase:** Storage alert at **400MB** (dashboard / metrics).
- **Hosting (Vercel/Railway/Render):** Error-rate alerts for **5xx** spikes.

## Implemented in this API (SQLite + Prisma)

- JWT on all routes (user id from token only). Plan for gating uses **RevenueCat REST** when `REVENUECAT_SECRET_API_KEY` is set (cached), else **`UserProfile.plan`** (updated by webhooks).
- **Upstash Redis** optional: set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` for distributed rate limits; otherwise **per-process memory** with the same numeric limits.
- Voice: **10 sessions/day**, **50/month** (UTC), **10MB** audio, **≥1s** duration, **10/hour** rate limit per user on `/api/transcribe`.
- SMS: **5/user/day**, **3 verification sends/phone/hour**, **20/day** auto-flag + block + alert email; **hashed** verification codes; **Twilio** + **RevenueCat** webhooks verify signatures (**403** on failure).
- **Sign in with Apple (server-to-server):** `POST /api/auth/apple/notifications` with JSON `{ "payload": "<JWS>" }`. The JWS is verified with Apple’s JWKS (`iss` `https://appleid.apple.com`, `aud` your bundle ID); invalid token → **403**. Requires **`SUPABASE_SERVICE_ROLE_KEY`**. Handles **`account-deleted`** (and alias **`account-delete`**), **`consent-revoked`**, **`email-disabled`** (and **`email-enabled`**). Users are resolved by **`UserProfile.appleSubject`** or a paginated Supabase **`listUsers`** scan matching Apple identities.
- `twilio_logs` table: **TwilioLog** model.

## Postgres RLS (Supabase)

App data lives in the **API database** (SQLite/Postgres via `DATABASE_URL`), not Supabase Postgres. **Row-level security** on Supabase tables applies only if you **migrate** app tables into Supabase and attach `auth.uid()` policies. Until then, enforcement is **JWT + Prisma** in this service.

## Secrets

Never commit `.env`. Rotate any key that ever appeared in git history. Required server-only secrets include:

`SUPABASE_SERVICE_ROLE_KEY` (required for Apple notifications + admin user delete / session revoke), `OPENAI_API_KEY`, `TWILIO_AUTH_TOKEN`, `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `UPSTASH_REDIS_REST_TOKEN`, `CRON_SECRET` (for `/internal/weekly-digest`). Optional: **`APPLE_NOTIFICATIONS_AUDIENCE`** if the JWT `aud` is not `com.buttontech.button`.

## Weekly digest

`GET /internal/weekly-digest` with `Authorization: Bearer <CRON_SECRET>`. Wire a Monday 9am cron on your host. Set `RESEND_API_KEY` + `SECURITY_ALERT_EMAIL` for email delivery.
