import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getAuthUser } from "@hono/auth-js";
import type { Context } from "hono";
import { PromptListQuerySchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { getPromptBySlug, listPrompts, listRelatedPrompts } from "../repositories/prompts.ts";

const app = new Hono();

async function currentUserId(c: Context): Promise<string | undefined> {
  // Public endpoints: session is optional. Use getAuthUser (non-throwing) instead
  // of verifyAuth() so anonymous requests still succeed.
  try {
    const authUser = (await getAuthUser(c)) as { session?: { user?: { id?: string } } } | null;
    return authUser?.session?.user?.id;
  } catch {
    return undefined;
  }
}

app.get("/", zv("query", PromptListQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const userId = await currentUserId(c);
  const result = await listPrompts(query, userId);
  return c.json(result);
});

app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const userId = await currentUserId(c);
  const detail = await getPromptBySlug(slug, userId);
  if (!detail) throw new HTTPException(404, { message: "prompt_not_found" });

  const related = await listRelatedPrompts(detail.id, detail.category.id, 12);
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
      primaryImage: r.primaryImage,
    })),
  });
});

export default app;
