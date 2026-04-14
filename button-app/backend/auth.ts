import { createClient } from "@supabase/supabase-js";
import { env } from "./env.ts";

// Supabase admin client for server-side JWT verification
const supabaseUrl = env.SUPABASE_URL ?? "";
const supabaseAnonKey = env.SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

export type SupabaseUser = {
  id: string;
  email?: string;
  role?: string;
};

/**
 * Verify a Supabase JWT from the Authorization header.
 * Returns the user if valid, null otherwise.
 */
export async function verifyToken(authHeader: string | null): Promise<SupabaseUser | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email, role: data.user.role };
}
