import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env.ts";

let cached: SupabaseClient | null | undefined;

export function getSupabaseAdmin(): SupabaseClient | null {
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const url = env.SUPABASE_URL?.trim();
  if (!key || !url) return null;
  if (cached === undefined) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
