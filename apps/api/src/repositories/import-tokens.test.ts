import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import { importTokens } from "../db/schema/system.ts";
import {
  createImportToken,
  consumeImportToken,
  ConsumeError,
} from "./import-tokens.ts";

const TEST_USER_EMAIL = "test-import-tokens@example.com";

async function ensureTestUser(): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_USER_EMAIL));
  if (existing) return existing.id;
  const [inserted] = await db.insert(users).values({
    email: TEST_USER_EMAIL,
    name: "Test User",
  }).returning({ id: users.id });
  return inserted!.id;
}

beforeEach(async () => {
  await db.delete(importTokens);
});

afterAll(async () => {
  await db.delete(importTokens);
  await db.delete(users).where(eq(users.email, TEST_USER_EMAIL));
  await pool.end();
});

describe("createImportToken", () => {
  it("creates a row with 8-char base62 token, 24h expires, and user binding", async () => {
    const userId = await ensureTestUser();
    const result = await createImportToken({
      userId,
      payload: { prompt: { en: "test" } },
      ip: "127.0.0.1",
    });

    expect(result.token).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(result.expiresAt).toBeInstanceOf(Date);

    const expectedExpiry = Date.now() + 24 * 60 * 60 * 1000;
    expect(result.expiresAt.getTime()).toBeGreaterThan(expectedExpiry - 60_000);
    expect(result.expiresAt.getTime()).toBeLessThan(expectedExpiry + 60_000);

    const [row] = await db.select().from(importTokens).where(eq(importTokens.token, result.token));
    expect(row).toBeDefined();
    expect(row!.userId).toBe(userId);
    expect(row!.used).toBe(false);
    expect(row!.createdIp).toBe("127.0.0.1");
  });
});

describe("consumeImportToken", () => {
  it("returns payload on first consume and increments send_count", async () => {
    const userId = await ensureTestUser();

    const { prompts: promptsTable } = await import("../db/schema/prompts.ts");
    const [anyPrompt] = await db.select({ id: promptsTable.id, sendCount: promptsTable.sendCount }).from(promptsTable).limit(1);

    const created = await createImportToken({
      userId,
      payload: { prompt: { en: "consume test" } },
      ...(anyPrompt?.id ? { promptId: anyPrompt.id } : {}),
    });

    const payload = await consumeImportToken(created.token);
    expect(payload).toEqual({ prompt: { en: "consume test" } });

    if (anyPrompt) {
      const [after] = await db.select({ sendCount: promptsTable.sendCount }).from(promptsTable).where(eq(promptsTable.id, anyPrompt.id));
      expect(after!.sendCount).toBe(anyPrompt.sendCount + 1);
    }
  });

  it("throws ConsumeError(token_not_found) for unknown token", async () => {
    await expect(consumeImportToken("00000000")).rejects.toMatchObject({
      name: "ConsumeError",
      code: "token_not_found",
    });
  });

  it("throws ConsumeError(token_used) on second consume", async () => {
    const userId = await ensureTestUser();
    const created = await createImportToken({
      userId,
      payload: { prompt: { en: "double-spend test" } },
    });
    await consumeImportToken(created.token);
    await expect(consumeImportToken(created.token)).rejects.toMatchObject({
      name: "ConsumeError",
      code: "token_used",
    });
  });

  it("throws ConsumeError(token_expired) for past expires_at", async () => {
    const userId = await ensureTestUser();
    const token = "ZZZ12345";
    await db.insert(importTokens).values({
      token,
      userId,
      payload: { prompt: { en: "expired" } },
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(consumeImportToken(token)).rejects.toMatchObject({
      name: "ConsumeError",
      code: "token_expired",
    });
  });

  it("CAS prevents double-spend under concurrent consumes", async () => {
    const userId = await ensureTestUser();
    const created = await createImportToken({
      userId,
      payload: { prompt: { en: "concurrency test" } },
    });

    const [r1, r2] = await Promise.allSettled([
      consumeImportToken(created.token),
      consumeImportToken(created.token),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      name: "ConsumeError",
      code: "token_used",
    });
  });
});
