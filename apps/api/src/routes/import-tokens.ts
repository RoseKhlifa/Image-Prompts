import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { verifyAuth } from "@hono/auth-js";
import { ImportTokenRequestSchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { createImportToken } from "../repositories/import-tokens.ts";

const app = new Hono();

const userLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
const ipLimiter = createRateLimiter({ limit: 200, windowMs: 60_000 });

const POST_MAX_BYTES = 4096;

app.post(
  "/",
  verifyAuth(),
  bodyLimit({
    maxSize: POST_MAX_BYTES,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
  zv("json", ImportTokenRequestSchema),
  async (c) => {
    const authUser = c.get("authUser");
    if (!authUser?.session?.user?.id) {
      throw new HTTPException(401, { message: "unauthorized" });
    }
    const userId = authUser.session.user.id as string;
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown";

    if (!userLimiter.check(userId)) {
      throw new HTTPException(429, { message: "rate_limit" });
    }
    if (!ipLimiter.check(ip)) {
      throw new HTTPException(429, { message: "rate_limit" });
    }

    const body = c.req.valid("json");
    const result = await createImportToken({
      userId,
      payload: {
        prompt: body.prompt,
        ...(body.negative_prompt !== undefined ? { negative_prompt: body.negative_prompt } : {}),
        ...(body.aspect_ratio !== undefined ? { aspect_ratio: body.aspect_ratio } : {}),
      },
      promptId: body.prompt_id,
      ip,
    });

    return c.json(
      {
        token: result.token,
        expires_at: result.expiresAt.toISOString(),
      },
      201,
    );
  },
);

export default app;
