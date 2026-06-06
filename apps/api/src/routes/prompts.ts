import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { PromptListQuerySchema } from "@ip/shared";
import { getPromptBySlug, listPrompts, listRelatedPrompts } from "../repositories/prompts.ts";

const app = new Hono();

app.get("/", zValidator("query", PromptListQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const result = await listPrompts(query);
  return c.json(result);
});

app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const detail = await getPromptBySlug(slug);
  if (!detail) throw new HTTPException(404, { message: "prompt_not_found" });

  const related = await listRelatedPrompts(detail.id, detail.category.id, 6);
  return c.json({
    ...detail,
    related: related.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      aspectRatio: r.aspectRatio,
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      sendCount: r.sendCount,
      favoriteCount: r.favoriteCount,
      approvedAt: r.approvedAt.toISOString(),
    })),
  });
});

export default app;
