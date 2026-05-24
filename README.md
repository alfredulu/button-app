# Button

Voice-first AI calendar planner for iOS and Android.

Speak your plans. Button transcribes your voice, extracts the events using GPT-4o, and adds them directly to Calendar. Pro users get SMS reminders, planning streaks, badges, weekly scores, and accountability partners.

---

## Repo structure

```
button-app/
├── backend/        Bun + Hono REST API, Prisma ORM, PostgreSQL
└── mobile/         Expo React Native app (file-based routing via Expo Router)
```

---

## Tech stack

### Backend

| Layer         | Choice                                                     |
| ------------- | ---------------------------------------------------------- |
| Runtime       | Bun                                                        |
| Framework     | Hono 4.6                                                   |
| Database      | PostgreSQL via Prisma 6                                    |
| Auth          | Supabase (JWT validation)                                  |
| AI            | OpenAI Whisper (transcription) + GPT-4o (event extraction) |
| Calendar      | Google Calendar API v3 (OAuth 2.0)                         |
| SMS           | Twilio                                                     |
| Subscriptions | RevenueCat webhooks                                        |
| Rate limiting | In-memory sliding window + Upstash Redis                   |
| Validation    | Zod 4                                                      |
| Email         | Resend                                                     |
| Deployment    | Render.com                                                 |

### Mobile

| Layer         | Choice                                        |
| ------------- | --------------------------------------------- |
| Framework     | Expo 54 + React Native 0.81                   |
| Navigation    | Expo Router 6 (file-based) + React Navigation |
| Styling       | NativeWind 4 (Tailwind CSS)                   |
| State         | TanStack Query 5 + Zustand                    |
| Auth          | Better-auth Expo client + Supabase            |
| Audio         | expo-av                                       |
| Subscriptions | RevenueCat SDK (react-native-purchases)       |
| Animations    | React Native Reanimated 4 + Lottie            |
| Storage       | MMKV + AsyncStorage                           |
| Fonts         | Playfair Display, DM Sans, DM Serif Display   |

---

## Features

**Free tier**

- Voice recording with live waveform animation
- OpenAI Whisper transcription
- GPT-4o event extraction
- Google Calendar sync
- Planning streak tracking
- Session history (last 50)
- 10 voice sessions per day, 50 per month

**Pro tier (RevenueCat subscription)**

- Unlimited voice sessions
- SMS reminders via Twilio (15, 30, 60, 120 min or morning of)
- Weekly planning score
- Full badge collection (streaks, early riser, weekend warrior, etc.)
- Accountability partner system
- Partner insights on profile

---

## Local development

### Prerequisites

- [Bun](https://bun.sh/) for the backend
- Node.js + npm for the mobile app
- PostgreSQL database (or a Render/Supabase connection string)
- [ngrok](https://ngrok.com/) to expose your local backend to a physical device

### 1. Backend

```bash
cd backend
npm install
npx prisma@6 generate
npx prisma@6 db push
npm run dev
```

The server starts on `http://localhost:3000`.

### 2. Expose backend to your phone

```bash
ngrok http 3000
```

Copy the HTTPS URL. You will use it as `BACKEND_URL` (backend env) and `EXPO_PUBLIC_BACKEND_URL` (mobile env).

### 3. Mobile

```bash
cd mobile
npm install
npx expo start --tunnel
```

Scan the QR code with Expo Go on your iPhone or Android device.

---

## Environment variables

### Backend (`backend/.env`)

```env
# Server
PORT=3000
BACKEND_URL=https://your-ngrok-or-render-url.com
DATABASE_URL=postgresql://user:pass@host/db

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Google OAuth (Calendar)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# OpenAI
OPENAI_API_KEY=sk-proj-...

# Twilio (SMS reminders)
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...

# RevenueCat
REVENUECAT_SECRET_API_KEY=appl_...
REVENUECAT_WEBHOOK_SECRET=...
REVENUECAT_ENTITLEMENT_PRO=pro

# Upstash Redis (rate limiting)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# Email (Resend)
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=...
SECURITY_ALERT_EMAIL=...

# Internal cron auth
CRON_SECRET=your-secret-token
```

### Mobile (`mobile/.env`)

```env
EXPO_PUBLIC_BACKEND_URL=https://your-ngrok-url.com
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# RevenueCat SDK keys
EXPO_PUBLIC_VIBECODE_REVENUECAT_TEST_KEY=...   # Expo Go testing
EXPO_PUBLIC_REVENUECAT_IOS_KEY=appl_...
EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=goog_...
```

---

## API routes

All authenticated routes require `Authorization: Bearer <supabase-jwt>`.

| Method | Path                              | Auth   | Rate limit  | Purpose                                  |
| ------ | --------------------------------- | ------ | ----------- | ---------------------------------------- |
| GET    | `/health`                         | No     | 20/min      | Health check                             |
| POST   | `/api/transcribe`                 | Yes    | 10/min      | Upload audio, get extracted events       |
| GET    | `/api/user/profile`               | Yes    | 60/min      | User profile                             |
| GET    | `/api/user/plan-status`           | Yes    | 60/min      | Free tier quota                          |
| GET    | `/api/user/planning-profile`      | Yes    | 60/min      | Streaks, scores, badges                  |
| GET    | `/api/user/partner-insights`      | Yes    | 60/min      | Accountability partner stats             |
| PATCH  | `/api/user/settings`              | Yes    | 60/min      | Update display name, username, SMS prefs |
| POST   | `/api/user/phone/send-code`       | Yes    | strict + IP | Send OTP                                 |
| POST   | `/api/user/phone/verify`          | Yes    | strict + IP | Verify OTP                               |
| GET    | `/api/google-calendar/status`     | Yes    | 60/min      | Check if calendar connected              |
| GET    | `/api/google-calendar/auth-url`   | Yes    | 60/min      | Get Google OAuth URL                     |
| GET    | `/api/google-calendar/callback`   | No     | strict + IP | OAuth redirect handler                   |
| POST   | `/api/google-calendar/disconnect` | Yes    | 60/min      | Revoke tokens                            |
| POST   | `/api/google-calendar/add-events` | Yes    | 10/min      | Add events to Google Calendar            |
| GET    | `/api/sessions`                   | Yes    | 60/min      | Voice session history                    |
| POST   | `/api/reminders/schedule`         | Yes    | 60/min      | Schedule SMS reminders (Pro)             |
| POST   | `/api/reminders/webhook`          | No     | 20/min      | Twilio delivery status callback          |
| GET    | `/api/social/search`              | Yes    | 60/min      | Search users by username                 |
| POST   | `/api/social/partner`             | Yes    | 60/min      | Link accountability partner              |
| DELETE | `/api/social/partner`             | Yes    | 60/min      | Unlink partner                           |
| POST   | `/api/webhooks/revenuecat`        | No     | N/A         | RevenueCat subscription events           |
| GET    | `/internal/weekly-digest`         | Bearer | N/A         | Cron-triggered weekly email              |

---

## Database schema (Prisma)

Key models in `backend/schema.prisma`:

- **UserProfile** - plan, Google OAuth tokens, phone/SMS settings, streak counters, weekly scores, badges, onboarding data
- **VoiceSession** - transcript, event count, duration, timezone
- **CalendarEvent** - extracted event title, date, time, location, Google Calendar event ID
- **SmsReminder** - scheduled send time, delivery status, Twilio message SID
- **PlanningDay** - one row per day the user plans (used for streak calculation)
- **PhoneVerification** - hashed OTP, expiry, attempt count
- **Badge** - badge type + earned date per user
- **WeeklyScoreRecord** - score per ISO week per user
- **TwilioLog** - audit log of all SMS sends

---

## Google Calendar setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Calendar API**.
3. Create an OAuth 2.0 client (type: **Web application**).
4. Add these authorized redirect URIs:
   - `http://localhost:3000/api/google-calendar/callback`
   - Your Render backend URL + `/api/google-calendar/callback`
5. Copy `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` into `backend/.env`.

---

## Deployment

**Backend** deploys to [Render.com](https://render.com). Point it at the `backend/` directory. Set all backend env vars in the Render dashboard. Prisma migrations run via `npx prisma@6 migrate deploy` as a pre-deploy command.

**Mobile** builds via [EAS Build](https://expo.dev/eas):

```bash
# iOS
eas build --platform ios --profile preview

# Android
eas build --platform android --profile preview
```

Set `EXPO_PUBLIC_BACKEND_URL` to your Render URL for production builds.

---

## Architecture notes

**Voice pipeline**

`POST /api/transcribe` receives the audio file, sends it to OpenAI Whisper, then passes the transcript to GPT-4o with a system prompt that extracts structured event objects (title, date, time, location, reminder preference). The extracted events are returned to the mobile client and stored as a `VoiceSession` with linked `CalendarEvent` rows.

**Plan enforcement**

On every protected request the backend resolves the user's plan. It checks the cached `plan` field on `UserProfile` first. On a cache miss it calls the RevenueCat REST API to check active entitlements. RevenueCat webhooks keep the DB in sync when subscriptions change.

**Rate limiting**

Two layers run in parallel. An in-memory sliding window handles burst traffic without a network hop. Upstash Redis provides distributed rate limiting across multiple server instances. Expensive endpoints (transcribe, calendar add) are capped at 10 requests per minute per user. Standard endpoints allow 60 per minute.

**SMS reminders**

A background worker polls the database every 60 seconds for `SmsReminder` rows where `sent = false` and `scheduledFor <= now`. Before sending it verifies the user has a verified phone number, SMS enabled, and is not flagged. Twilio posts delivery status back to `/api/reminders/webhook`, which updates the `deliveryStatus` field.

**Security**

- Supabase JWT validated on every authenticated request
- All queries scoped to the authenticated user ID (no user ID from URL params)
- HMAC-SHA256 signed state parameter on Google OAuth to prevent CSRF
- Input sanitized against XSS and injection before storage
- Audio payload capped at 13 MB
- CORS restricted to known origins
- Security headers set via Hono middleware (HSTS, CSP, X-Frame-Options)
