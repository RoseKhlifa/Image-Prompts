import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { ImportTokenRequestSchema } from "@ip/shared";
import { softAuth } from "../middleware/auth.ts";
import { zv } from "../lib/validate.ts";
import { banCheck } from "../middleware/ban-check.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import {
  consumeImportToken,
  ConsumeError,
  createImportToken,
} from "../repositories/import-tokens.ts";

const app = new Hono();

const userLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
// Tighter limit for guests since the IP is the only abuse-control key
// available — signed-in visitors have their per-user budget AND the IP
// budget on top.
const ipLimiter = createRateLimiter({ limit: 200, windowMs: 60_000 });
const guestIpLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

const POST_MAX_BYTES = 4096;

app.post(
  "/",
  softAuth(),
  banCheck(),
  bodyLimit({
    maxSize: POST_MAX_BYTES,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
  zv("json", ImportTokenRequestSchema),
  async (c) => {
    const authUser = c.get("authUser") as
      | { session?: { user?: { id?: string } } }
      | undefined;
    const userId = authUser?.session?.user?.id ?? null;
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "unknown";

    if (userId) {
      // Signed-in: per-user limit (also IP-checked below as a backstop).
      if (!userLimiter.check(userId)) {
        throw new HTTPException(429, { message: "rate_limit" });
      }
      if (!ipLimiter.check(ip)) {
        throw new HTTPException(429, { message: "rate_limit" });
      }
    } else {
      // Anonymous: only the tighter guest IP budget applies.
      if (!guestIpLimiter.check(ip)) {
        throw new HTTPException(429, { message: "rate_limit" });
      }
    }

    const body = c.req.valid("json");
    const result = await createImportToken({
      userId,
      payload: {
        prompt: body.prompt,
        ...(body.negative_prompt !== undefined ? { negative_prompt: body.negative_prompt } : {}),
        ...(body.aspect_ratio !== undefined ? { aspect_ratio: body.aspect_ratio } : {}),
      },
      ...(body.prompt_id !== undefined ? { promptId: body.prompt_id } : {}),
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
