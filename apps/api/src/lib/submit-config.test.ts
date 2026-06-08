import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getSubmitConfig, resetSubmitConfigCache } from "./submit-config.ts";
import { setSetting } from "../repositories/site-settings.ts";
import { db } from "../db/client.ts";
import { siteSettings } from "../db/schema/index.ts";

describe("getSubmitConfig", () => {
  beforeEach(() => {
    resetSubmitConfigCache();
  });

  // Defensively restore the seed value after the whole suite so a mid-suite
  // crash can't leave a poisoned submit.daily_limit row to break sibling tests.
  afterAll(async () => {
    await setSetting("submit.daily_limit", 10, null);
    resetSubmitConfigCache();
  });

  it("reads DAILY_LIMIT from site_settings", async () => {
    await setSetting("submit.daily_limit", 42, null);
    resetSubmitConfigCache();
    const cfg = await getSubmitConfig();
    expect(cfg.DAILY_LIMIT).toBe(42);
    // restore so we don't pollute downstream tests
    await setSetting("submit.daily_limit", 10, null);
    resetSubmitConfigCache();
  });

  it("falls back to defaults when key missing", async () => {
    await db.delete(siteSettings).where(eq(siteSettings.key, "submit.daily_limit"));
    resetSubmitConfigCache();
    const cfg = await getSubmitConfig();
    expect(cfg.DAILY_LIMIT).toBe(10); // FALLBACK
    // restore
    await setSetting("submit.daily_limit", 10, null);
    resetSubmitConfigCache();
  });

  it("caches across calls within TTL", async () => {
    await setSetting("submit.daily_limit", 7, null);
    resetSubmitConfigCache();
    const a = await getSubmitConfig();
    // Change DB underneath; cached snapshot should not see it
    await setSetting("submit.daily_limit", 99, null);
    const b = await getSubmitConfig();
    expect(b.DAILY_LIMIT).toBe(a.DAILY_LIMIT);
    expect(b.DAILY_LIMIT).toBe(7);
    // restore
    await setSetting("submit.daily_limit", 10, null);
    resetSubmitConfigCache();
  });

  it("re-reads after resetSubmitConfigCache()", async () => {
    await setSetting("submit.daily_limit", 7, null);
    resetSubmitConfigCache();
    const a = await getSubmitConfig();
    expect(a.DAILY_LIMIT).toBe(7);
    await setSetting("submit.daily_limit", 99, null);
    resetSubmitConfigCache();
    const b = await getSubmitConfig();
    expect(b.DAILY_LIMIT).toBe(99);
    // restore
    await setSetting("submit.daily_limit", 10, null);
    resetSubmitConfigCache();
  });
});
