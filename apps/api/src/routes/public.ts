import { Hono } from "hono";
import { listR2PoolPublic } from "../repositories/r2-accounts.ts";

const app = new Hono();

app.get("/r2-pool", async (c) => {
  const rows = await listR2PoolPublic();
  return c.json(rows);
});

export default app;
