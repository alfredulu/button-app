import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env.ts";

let adminClient: SupabaseClient | null = null;
let adminClientChecked = false;

/** Service-role client for admin auth APIs. Returns null if key not configured. */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (adminClientChecked) return adminClient;
  adminClientChecked = true;
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) return null;
  adminClient = createClient(env.SUPABASE_URL, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return adminClient;
}
