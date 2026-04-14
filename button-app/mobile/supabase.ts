import { createClient, SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

function missingConfigMessage(): string {
  return (
    "Supabase env missing. In mobile/.env set (same project as backend):\n" +
    "  EXPO_PUBLIC_SUPABASE_URL=https://izjjnkwhinmqxhgrsymn.supabase.co\n" +
    "  EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml6ampua3doaW5tcXhoZ3JzeW1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MjExMzMsImV4cCI6MjA4ODM5NzEzM30.NxnNeuls7-vf3tDX4-zJvL9XqtJMIrYwkfePV5lHNPg\n" +
    "Restart Expo (npx expo start --clear) after saving."
  );
}

let client: SupabaseClient;

if (!supabaseUrl || !supabaseAnonKey) {
  if (__DEV__) {
    // console.error becomes a redbox in Expo — warn only
    console.warn(missingConfigMessage());
  }
  // Dummy client avoids immediate crash; auth calls will fail until .env is fixed.
  client = createClient("https://placeholder.supabase.co", "placeholder-anon-key", {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
} else {
  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

export const supabase = client;

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
