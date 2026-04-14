import type { MiddlewareHandler } from "hono";
import type { SupabaseUser } from "../auth";

/** 401 if no valid Supabase user in context (run after global JWT middleware). */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const user = c.get("user") as SupabaseUser | null;
  if (!user?.id) {
    return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }
  await next();
};
