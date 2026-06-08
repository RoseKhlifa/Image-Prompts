import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { like } from "drizzle-orm";
import { createServer } from "../server.ts";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { createTestSession } from "../auth/test-session.ts";
import { setSetting } from "../repositories/site-settings.ts";
import { _resetLimiter } from "./translate.ts";

/**
 * M10b W4.2: /api/translate endpoint tests.
 *
 * The route calls translate(input, config) without injecting a fetchImpl —
 * so we mock globalThis.fetch via vi.stubGlobal for the entire suite. Each
 * test that needs the route to "succeed" pre-stubs a /responses canonical
 * envelope; tests that exercise error mapping return non-OK responses.
 *
 * We also reset the per-process rate-limit cache (_resetLimiter) between
 * tests so an earlier test can't poison the next one's counter.
 */

const TEST_EMAIL_PREFIX = "translate-route-test-";

const app = createServer();

/**
 * Restore translator.* to safe defaults BEFORE every test so a previous
 * test's setSetting cannot leak settings (and especially can't leave
 * enabled=true + a real apiKey, which would risk a real upstream call).
 */
async function resetTranslatorSettings() {
  await setSetting("translator.enabled", false, null);
  await setSetting("translator.base_url", "https://api.example.com/v1", null);
  await setSetting("translator.api_key", "", null);
  await setSetting("translator.model", "gpt-4o-mini", null);
  await setSetting("translator.system_prompt", "", null);
  await setSetting("translator.max_chars_per_request", 2000, null);
  await setSetting("translator.rate_limit_per_user_hour", 20, null);
}

beforeEach(async () => {
  _resetLimiter();
  await resetTranslatorSettings();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  // Final safety net: leave translator disabled + apiKey blank so dev
  // accidentally hitting the endpoint can't talk to real OpenAI.
  await resetTranslatorSettings();
  await db.delete(sessions);
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
  vi.unstubAllGlobals();
  await pool.end();
});

/**
 * Build a canonical /responses success body. Wrapped in a helper so each
 * test reads compactly.
 */
function okResponse(text: string) {
  return new Response(
    JSON.stringify({
      output: [{ content: [{ type: "output_text", text }] }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("POST /api/translate", () => {
  it("returns 401 when not signed in", async () => {
    const res = await app.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello", fromLocale: "en", toLocale: "zh" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when text is empty", async () => {
    const sess = await createTestSession({
      email: `${TEST_EMAIL_PREFIX}empty-${Date.now()}@example.com`,
    });
    await setSetting("translator.enabled", true, null);
    await setSetting("translator.api_key", "sk-test", null);
    const res = await app.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ text: "", fromLocale: "en", toLocale: "zh" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when fromLocale === toLocale", async () => {
    const sess = await createTestSession({
      email: `${TEST_EMAIL_PREFIX}same-${Date.now()}@example.com`,
    });
    await setSetting("translator.enabled", true, null);
    await setSetting("translator.api_key", "sk-test", null);
    const res = await app.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ text: "hello", fromLocale: "en", toLocale: "en" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 translator_disabled when enabled=false", async () => {
    const sess = await createTestSession({
      email: `${TEST_EMAIL_PREFIX}disabled-${Date.now()}@example.com`,
    });
    // enabled left at the default false from beforeEach.
    const res = await app.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ text: "hello", fromLocale: "en", toLocale: "zh" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toBe("translator_disabled");
  });

  it("returns 503 translator_unconfigured when apiKey is empty", async () => {
    const sess = await createTestSession({
      email: `${TEST_EMAIL_PREFIX}unconfig-${Date.now()}@example.com`,
    });
    await setSetting("translator.enabled", true, null);
    // api_key intentionally left empty from resetTranslatorSettings().
    const res = await app.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ text: "hello", fromLocale: "en", toLocale: "zh" }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toBe("translator_unconfigured");
  });

  it("returns 200 with translated text on happy path", async () => {
    const sess = await createTestSession({
      email: `${TEST_EMAIL_PREFIX}happy-${Date.now()}@example.com`,
    });
    await setSetting("translator.enabled", true, null);
    await setSetting("translator.api_key", "sk-test", null);
    await setSetting("translator.model", "gpt-4o-mini", null);

    const fakeFetch = vi.fn(async () => okResponse("你好"));
    vi.stubGlobal("fetch", fakeFetch);

    const res = await app.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ text: "hello", fromLocale: "en", toLocale: "zh" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { translated: string };
    expect(body.translated).toBe("你好");
    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("returns 502 upstream_error on upstream 500", async () => {
    const sess = await createTestSession({
      email: `${TEST_EMAIL_PREFIX}upstream-${Date.now()}@example.com`,
    });
    await setSetting("translator.enabled", true, null);
    await setSetting("translator.api_key", "sk-test", null);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );

    const res = await app.request("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ text: "hello", fromLocale: "en", toLocale: "zh" }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/^upstream_error:500/);
  });

  it("returns 429 rate_limited after exceeding rate_limit_per_user_hour", async () => {
    const sess = await createTestSession({
      email: `${TEST_EMAIL_PREFIX}ratelimit-${Date.now()}@example.com`,
    });
    await setSetting("translator.enabled", true, null);
    await setSetting("translator.api_key", "sk-test", null);
    await setSetting("translator.rate_limit_per_user_hour", 2, null);

    vi.stubGlobal("fetch", vi.fn(async () => okResponse("ok")));

    // Limit = 2: first two requests should succeed, the third must 429.
    const headers = { "Content-Type": "application/json", Cookie: sess.cookie };
    const body = JSON.stringify({ text: "hello", fromLocale: "en", toLocale: "zh" });

    const r1 = await app.request("/api/translate", { method: "POST", headers, body });
    const r2 = await app.request("/api/translate", { method: "POST", headers, body });
    const r3 = await app.request("/api/translate", { method: "POST", headers, body });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    const j = (await r3.json()) as { message?: string };
    expect(j.message).toBe("rate_limited");
  });
});
