import { useState, useEffect } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export const useSession = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) console.warn("[useSession] getSession:", error.message);
        setSession(data?.session ?? null);
        setIsLoading(false);
      })
      .catch((e) => {
        console.warn("[useSession] getSession failed:", e);
        setSession(null);
        setIsLoading(false);
      });

    const { data: subData } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setIsLoading(false);
    });
    const subscription = subData?.subscription;

    return () => subscription?.unsubscribe();
  }, []);

  return { data: session ? { user: session.user } : null, isLoading, session };
};

export const useSignOut = () => {
  return () => supabase.auth.signOut();
};
