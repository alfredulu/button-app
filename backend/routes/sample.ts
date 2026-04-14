import { Hono } from "hono";
import { rateLimit } from "../middleware/rateLimit";

const sampleRouter = new Hono();

sampleRouter.get(
  "/",
  rateLimit("publicStrict"),
  (c) => {
    return c.json({
      data: {
        message: `${["Hello", "Hola", "Namaste", "Bonjour"][Math.floor(Math.random() * 4)]} from the backend!`,
        timestamp: new Date().toLocaleTimeString(),
      },
    });
  }
);

export { sampleRouter };

