import { Hono } from "hono";
import { listTags } from "../repositories/tags.ts";

const app = new Hono();

app.get("/", async (c) => {
  const rows = await listTags();
  return c.json(rows);
});

export default app;
