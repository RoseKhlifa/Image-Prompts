import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";

const app = new Hono();

app.get("/", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", db: "ok", time: new Date().toISOString() });
  } catch (err) {
    return c.json(
      {
        status: "degraded",
        db: "down",
        time: new Date().toISOString(),
        message: err instanceof Error ? err.message : String(err),
      },
      503,
    );
  }
});

export default app;
