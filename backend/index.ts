// import "@vibecodeapp/proxy";
import { Hono } from "hono";
import { cors } from "hono/cors";
import "./env.ts";
import { verifyToken } from "./auth";
import type { SupabaseUser } from "./auth";
import { sampleRouter } from "./routes/sample";
import { transcribeRouter } from "./routes/transcribe";
import { sessionsRouter } from "./routes/sessions";
import { userRouter } from "./routes/user";
import { googleCalendarRouter } from "./routes/googleCalendar";
import { calendarRouter } from "./routes/calendar";
import { remindersPublicRouter } from "./routes/reminders";
import { remindersAuthRouter } from "./routes/remindersSchedule";
import { revenuecatWebhookRouter } from "./routes/revenuecatWebhook";
import { internalWeeklyRouter } from "./routes/internalWeekly";
import { socialRouter } from "./routes/social";
import { logger } from "hono/logger";
import { rateLimit } from "./middleware/rateLimit";
import { processDueSmsReminders } from "./services/smsReminderWorker";

const app = new Hono<{
  Variables: {
    user: SupabaseUser | null;
  };
}>();

const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecodeapp\.com$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.dev$/,
  /^https:\/\/vibecode\.dev$/,
  /^https:\/\/[a-z0-9-]+\.onrender\.com$/,
];

app.use(
  "*",
  cors({
    origin: (origin) =>
      origin && allowed.some((re) => re.test(origin)) ? origin : null,
    credentials: true,
  })
);

app.use("*", logger());

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

/** ~12.5MB — 10MB audio + multipart overhead */
const MAX_BODY_SIZE_BYTES = 13 * 1024 * 1024;

app.use("*", async (c, next) => {
  const contentLength = c.req.header("content-length");
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (!isNaN(length) && length > MAX_BODY_SIZE_BYTES) {
      return c.json(
        {
          error: {
            message: "Request body too large.",
            code: "PAYLOAD_TOO_LARGE",
          },
        },
        413
      );
    }
  }
  await next();
});

app.route("/internal", internalWeeklyRouter);

app.use("*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const user = await verifyToken(authHeader ?? null);
  c.set("user", user);
  await next();
});

app.get("/", rateLimit("publicStrict"), (c) =>
  c.json({
    service: "Button API",
    health: "/health",
    hint: "JSON API only — routes live under /api/* (send Authorization: Bearer <token> for protected endpoints).",
  })
);

app.get("/health", rateLimit("publicStrict"), (c) => c.json({ status: "ok" }));

app.route("/api/sample", sampleRouter);
app.route("/api/transcribe", transcribeRouter);
app.route("/api/sessions", sessionsRouter);
app.route("/api/user", userRouter);
app.route("/api/google-calendar", googleCalendarRouter);
app.route("/api/calendar", calendarRouter);
app.route("/api/reminders", remindersPublicRouter);
app.route("/api/reminders", remindersAuthRouter);
app.route("/api/webhooks/revenuecat", revenuecatWebhookRouter);
app.route("/api/social", socialRouter);

setInterval(() => {
  processDueSmsReminders().catch((err) => console.error("[sms-worker]", err));
}, 60_000);

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};
