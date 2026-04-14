import { Hono } from "hono";
import type { SupabaseUser } from "../auth";
import { rateLimit } from "../middleware/rateLimit";
import { upstashCalendarAddLimit } from "../middleware/upstashLimits";
import { validateBody } from "../middleware/validation";
import { calendarAddBodySchema, addEventsViaGoogleCalendar, runPostCalendarAddHooks } from "../services/calendarAdd";
import { DEFAULT_TIME_ZONE } from "../lib/zonedTime";

export const calendarRouter = new Hono<{ Variables: { user: SupabaseUser | null } }>();

calendarRouter.post(
  "/add",
  rateLimit("authStrict"),
  upstashCalendarAddLimit,
  validateBody(calendarAddBodySchema),
  async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);

    const body = c.req.valid("json");
    const timeZone = body.timeZone ?? DEFAULT_TIME_ZONE;

    try {
      const { created } = await addEventsViaGoogleCalendar(user.id, body);
      await runPostCalendarAddHooks(user.id, created, timeZone);
      return c.json({ data: { created } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "NOT_CONNECTED") {
        return c.json(
          { error: { message: "Google Calendar is not connected.", code: "NOT_CONNECTED" } },
          403
        );
      }
      if (msg === "GOOGLE_API_ERROR") {
        return c.json(
          { error: { message: "Could not add events to Google Calendar.", code: "GOOGLE_API_ERROR" } },
          502
        );
      }
      throw e;
    }
  }
);
