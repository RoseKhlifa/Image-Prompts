import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db/client.ts";
import { siteSettings, users } from "../db/schema/index.ts";
import { like } from "drizzle-orm";
import {
  listAllSettings,
  getSetting,
  getSettingsByPrefix,
  setSetting,
} from "./site-settings.ts";

describe("site-settings repository", () => {
  let testUserId: string | null;

  beforeEach(async () => {
    // clean settings table to known state for keys we own
    await db.delete(siteSettings).where(like(siteSettings.key, "test.%"));
    // need a user for updatedBy FK; reuse first user or fall back to null
    // (FK allows NULL; hard-coded UUID would violate FK if no users seeded)
    const [u] = await db.select({ id: users.id }).from(users).limit(1);
    testUserId = u?.id ?? null;
  });

  it("setSetting + getSetting roundtrip primitive number", async () => {
    await setSetting("test.daily_limit", 25, testUserId);
    const v = await getSetting<number>("test.daily_limit");
    expect(v).toBe(25);
  });

  it("setSetting + getSetting roundtrip object", async () => {
    await setSetting("test.obj", { foo: "bar", n: 1 }, testUserId);
    const v = await getSetting<{ foo: string; n: number }>("test.obj");
    expect(v).toEqual({ foo: "bar", n: 1 });
  });

  it("setSetting + getSetting roundtrip array", async () => {
    await setSetting("test.mimes", ["image/jpeg", "image/png"], testUserId);
    const v = await getSetting<string[]>("test.mimes");
    expect(v).toEqual(["image/jpeg", "image/png"]);
  });

  it("getSetting returns undefined for missing key", async () => {
    const v = await getSetting("test.nonexistent");
    expect(v).toBeUndefined();
  });

  it("setSetting upserts (writes second time updates value + updatedAt)", async () => {
    await setSetting("test.upsert", "v1", testUserId);
    const a = await getSetting<string>("test.upsert");
    expect(a).toBe("v1");
    await setSetting("test.upsert", "v2", testUserId);
    const b = await getSetting<string>("test.upsert");
    expect(b).toBe("v2");
  });

  it("listAllSettings returns rows ordered by key asc (test.* subset)", async () => {
    await setSetting("test.bbb", 1, testUserId);
    await setSetting("test.aaa", 2, testUserId);
    const rows = await listAllSettings();
    const testRows = rows.filter((r) => r.key.startsWith("test."));
    expect(testRows[0]?.key).toBe("test.aaa");
    expect(testRows[1]?.key).toBe("test.bbb");
  });

  it("getSettingsByPrefix returns matching keys as map", async () => {
    await setSetting("test.a.x", 1, testUserId);
    await setSetting("test.a.y", 2, testUserId);
    await setSetting("test.b.z", 3, testUserId);
    const m = await getSettingsByPrefix("test.a.");
    expect(m.get("test.a.x")).toBe(1);
    expect(m.get("test.a.y")).toBe(2);
    expect(m.has("test.b.z")).toBe(false);
  });
});
