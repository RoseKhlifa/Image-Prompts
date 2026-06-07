import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { verifyAuth } from "@hono/auth-js";
import { ImportTokenRequestSchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { consumeImportToken, ConsumeError, createImportToken } from "../repositories/import-tokens.ts";

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

app.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!/^[0-9A-Za-z]{8}$/.test(token)) {
    return c.json({ error: "token_not_found" }, 404);
  }

  const ua = c.req.header("user-agent") ?? "";
  if (!ua.includes("Image-Studio/")) {
    console.warn(
      `[import-tokens] non-Image-Studio UA: "${ua.slice(0, 80)}" token=${token.slice(0, 3)}***`,
    );
  }

  try {
    const payload = await consumeImportToken(token);
    return c.json(payload, 200);
  } catch (e) {
    if (e instanceof ConsumeError) {
      const status = e.code === "token_not_found" ? 404 : 410;
      return c.json({ error: e.code }, status);
    }
    throw e;
  }
});

export default app;
