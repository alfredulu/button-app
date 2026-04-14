# button-app

Button - Voice-first AI calendar planner.

## Repo structure

- `backend/` - Bun + Hono API, Prisma schema, Google Calendar OAuth endpoints
- `mobile/` - Expo React Native app (Expo Go first, Dev Client later)

## Local development

### 1) Backend

```bash
cd backend
npm install
npx prisma@6 generate
npx prisma@6 db push
npm run dev
```

Set backend env values in `backend/env` (or your preferred local env file strategy):

- `BACKEND_URL` = your ngrok HTTPS URL when testing on physical devices
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
- `SUPABASE_URL` and `SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`

### 2) Expose backend to iPhone with ngrok

```bash
ngrok http 3000
```

Use the generated HTTPS URL as `BACKEND_URL` and mobile `EXPO_PUBLIC_BACKEND_URL`.

### 3) Mobile (Expo Go)

```bash
cd mobile
npm install
npx expo start --tunnel
```

Use Expo Go on your physical iPhone to scan the QR code.

## Google OAuth setup notes

- OAuth client type: Web
- Enable Google Calendar API in project `one-button-tomorrow`
- Add authorized redirect URIs:
  - Supabase callback URL
  - `http://localhost:3000/auth/callback`
  - Expo tunnel callback URL used in your flow
