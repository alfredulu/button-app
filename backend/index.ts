import "@vibecodeapp/proxy"; // DO NOT REMOVE OTHERWISE VIBECODE PROXY WILL NOT WORK
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
import { remindersRouter } from "./routes/reminders";
import { revenuecatWebhookRouter } from "./routes/revenuecatWebhook";
import { internalWeeklyRouter } from "./routes/internalWeekly";
import { socialRouter } from "./routes/social";
import { appleAuthRouter } from "./routes/appleAuthNotifications";
import { logger } from "hono/logger";
import { rateLimit } from "./middleware/rateLimit";
import { processDueSmsReminders } from "./services/smsReminderWorker";

const app = new Hono<{
  Variables: {
    user: SupabaseUser | null;
  };
}>();

// CORS middleware
const allowed = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.dev\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.run$/,
  /^https:\/\/[a-z0-9-]+\.vibecodeapp\.com$/,
  /^https:\/\/[a-z0-9-]+\.vibecode\.dev$/,
  /^https:\/\/vibecode\.dev$/,
];

app.use(
  "*",
  cors({
    origin: (origin) => (origin && allowed.some((re) => re.test(origin)) ? origin : null),
    credentials: true,
  })
);

app.use("*", logger());

/**
 * Security response headers middleware.
 *
 * OWASP: Proper security headers reduce attack surface for common web vulnerabilities.
 * - X-Content-Type-Options: Prevents MIME sniffing (content-type injection).
 * - X-Frame-Options: Prevents clickjacking attacks via iframe embedding.
 * - X-XSS-Protection: Legacy header; still useful for older browsers.
 * - Strict-Transport-Security: Enforces HTTPS connections (HSTS).
 * - Referrer-Policy: Limits information leaked in Referer headers to external sites.
 */
app.use("*", async (c, next) => {
  await next();
  // OWASP: Never expose server implementation details
  c.header("X-Content-Type-Options", "nosniff");
  // OWASP: Prevent clickjacking - this is a JSON API so framing is never legitimate
  c.header("X-Frame-Options", "DENY");
  // OWASP: Legacy XSS protection for older browsers
  c.header("X-XSS-Protection", "1; mode=block");
  // OWASP: Force HTTPS for 1 year; includeSubDomains extends to all subdomains
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // OWASP: Don't leak full URL in Referer header to third-party services
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

/**
 * Request body size limit middleware.
 *
 * OWASP API4:2023 Unrestricted Resource Consumption - reject oversized request
 * bodies before they are buffered into memory. 55MB allows the 50MB audio limit
 * plus multipart form overhead.
 */
const MAX_BODY_SIZE_BYTES = 12 * 1024 * 1024; // 10MB audio + multipart overhead

app.use("*", async (c, next) => {
  const contentLength = c.req.header("content-length");
  if (contentLength) {
    const length = parseInt(contentLength, 10);
    if (!isNaN(length) && length > MAX_BODY_SIZE_BYTES) {
      return c.json(
        {
          error: {
            message: "Request body too large. Maximum allowed size is 12MB.",
            code: "PAYLOAD_TOO_LARGE",
          },
        },
        413
      );
    }
  }
  await next();
});

// Auth middleware - verifies Supabase JWT
app.use("*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const user = await verifyToken(authHeader ?? null);
  c.set("user", user);
  await next();
});

// Root — browsers open / by default; this API has no HTML UI
app.get("/", rateLimit("publicStrict"), (c) =>
  c.json({
    service: "Button API",
    health: "/health",
    hint: "JSON API only — routes live under /api/* (send Authorization: Bearer <token> for protected endpoints).",
  })
);

// Health check - protected by publicStrict rate limit (20 req/min per IP)
// OWASP: Even health checks need rate limiting to prevent use as a timing oracle
app.get("/health", rateLimit("publicStrict"), (c) => c.json({ status: "ok" }));

// App routes
app.route("/api/sample", sampleRouter);
app.route("/api/transcribe", transcribeRouter);
app.route("/api/sessions", sessionsRouter);
app.route("/api/user", userRouter);
app.route("/api/google-calendar", googleCalendarRouter);
app.route("/api/calendar", calendarRouter);
app.route("/api/reminders", remindersRouter);
app.route("/api/webhooks/revenuecat", revenuecatWebhookRouter);
app.route("/api/auth", appleAuthRouter);
app.route("/internal", internalWeeklyRouter);
app.route("/api/social", socialRouter);

setInterval(() => {
  processDueSmsReminders().catch((err) => console.error("[sms-worker]", err));
}, 60_000);

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};
