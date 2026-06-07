import { Hono } from "hono";
import { z } from "zod";
import { zv } from "../lib/validate.ts";
import { searchTags } from "../repositories/tags.ts";

const QuerySchema = z.object({
  q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

const app = new Hono();

app.get("/", zv("query", QuerySchema), async (c) => {
  const q = c.req.valid("query");
  const rows = await searchTags(q.q ?? "", q.limit);
  return c.json(rows);
});

export default app;
