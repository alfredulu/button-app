/**
 * Run the Hono app on Node.js (no Bun). Use: npx tsx run-node.ts
 */
import { serve } from "@hono/node-server";
import server from "./index";

serve({
  fetch: server.fetch,
  port: server.port,
});

console.log(`[backend] listening on http://localhost:${server.port}`);
