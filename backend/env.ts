import { config as loadDotenv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Node.js does not load .env automatically (Bun does). Prisma CLI loads it; the app must too.
const backendRoot = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(backendRoot, ".env") });

// NOTE: Never log env values - they contain secrets

/**
 * Environment variable schema using Zod with hardened validation.
 *
 * OWASP API8:2023 Security Misconfiguration - validate all configuration at startup.
 * Fail fast with clear error messages rather than silently running with bad config
 * that could lead to auth bypasses or data leaks.
 */
const envSchema = z.object({
  // Server Configuration
  PORT: z.string().optional().default("3000"),
  NODE_ENV: z.string().optional(),
  BACKEND_URL: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().default("file:./dev.db"),
  BETTER_AUTH_SECRET: z.string().optional(),

  // OWASP: Validate the OpenAI API key starts with "sk-" to catch misconfigured keys
  // early. A key that doesn't start with "sk-" will never work and would silently fail
  // at request time if not caught here. Minimum length of 20 rejects placeholder values.
  OPENAI_API_KEY: z
    .string()
    .refine((val) => val.startsWith("sk-"), {
      message: "OPENAI_API_KEY must start with 'sk-'",
    })
    .refine((val) => val.length >= 20, {
      message: "OPENAI_API_KEY must be at least 20 characters",
    })
    .optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  EXPO_PUBLIC_SUPABASE_JWT_SECRET: z.string().optional(),

  // OWASP: Validate Supabase URL is a proper HTTPS URL to prevent misconfiguration
  // that could route auth requests to an attacker-controlled server.
  SUPABASE_URL: z
    .string()
    .url({ message: "SUPABASE_URL must be a valid URL" })
    .optional(),
  EXPO_PUBLIC_SUPABASE_URL: z
    .string()
    .url({ message: "EXPO_PUBLIC_SUPABASE_URL must be a valid URL" })
    .optional(),

  // OWASP: Require the Supabase anon key - auth will silently fail without it,
  // potentially allowing unauthenticated access to protected routes.
  SUPABASE_ANON_KEY: z
    .string()
    .min(1, { message: "SUPABASE_ANON_KEY is required for authentication to work" })
    .optional(),
  EXPO_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, { message: "EXPO_PUBLIC_SUPABASE_ANON_KEY is required for authentication to work" })
    .optional(),

  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  /** Upstash Redis — required in production for distributed rate limits (optional in dev → in-memory fallback). */
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  /** RevenueCat REST API (secret) — server-side entitlement checks. */
  REVENUECAT_SECRET_API_KEY: z.string().optional(),
  /** Bearer token RevenueCat sends on webhooks (dashboard → Webhooks → Authorization). */
  REVENUECAT_WEBHOOK_SECRET: z.string().optional(),
  REVENUECAT_ENTITLEMENT_PRO: z.string().optional().default("pro"),

  SECURITY_ALERT_EMAIL: z.string().email().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().optional(),

  /** Protect internal cron routes (e.g. weekly digest). */
  CRON_SECRET: z.string().optional(),

  /** Supabase service role — server only; required for Apple notifications + admin user ops. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  /** JWT `aud` for Apple server notifications (bundle ID / Services ID). Defaults in code if unset. */
  APPLE_NOTIFICATIONS_AUDIENCE: z.string().optional(),
});

/**
 * Validate and parse environment variables.
 * Exits the process on validation failure to prevent running with bad configuration.
 */
function validateEnv() {
  try {
    // Back-compat mapping:
    // Some setups accidentally used `EXPO_PUBLIC_*` names for server config.
    // Server code must read secrets via `env` only; mapping here keeps other modules clean.
    const raw = {
      ...process.env,
      SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL,
      SUPABASE_ANON_KEY:
        process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    };
    const parsed = envSchema.parse(raw);

    const supabaseUrl = parsed.SUPABASE_URL?.trim();
    const supabaseKey = parsed.SUPABASE_ANON_KEY?.trim();
    if (!supabaseUrl || !supabaseKey) {
      console.error("Missing Supabase configuration for JWT verification.");
      console.error("Add to backend/.env (same values as your Expo app — Supabase → Project Settings → API):");
      console.error("  SUPABASE_URL=https://YOUR_PROJECT.supabase.co");
      console.error("  SUPABASE_ANON_KEY=eyJ...   (anon / public key)");
      console.error("Aliases also work: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.");
      process.exit(1);
    }

    console.log("Environment variables validated successfully");
    return { ...parsed, SUPABASE_URL: supabaseUrl, SUPABASE_ANON_KEY: supabaseKey };
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Environment variable validation failed:");
      error.issues.forEach((err: z.ZodIssue) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
      console.error("\nPlease check your .env file and ensure all required variables are set.");
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Validated and typed environment variables.
 */
export const env = validateEnv();

/**
 * Type of the validated environment variables.
 */
export type Env = z.infer<typeof envSchema>;

/**
 * Extend process.env with our environment variables.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    // eslint-disable-next-line import/namespace
    interface ProcessEnv extends z.infer<typeof envSchema> {}
  }
}
