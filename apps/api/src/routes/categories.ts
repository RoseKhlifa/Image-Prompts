import { Hono } from "hono";
import { listCategories } from "../repositories/categories.ts";

const app = new Hono();

app.get("/", async (c) => {
  const rows = await listCategories();
  return c.json(rows);
});

export default app;
