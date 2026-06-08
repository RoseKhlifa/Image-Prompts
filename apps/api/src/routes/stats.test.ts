import { describe, it, expect, afterAll } from "vitest";
import { createServer } from "../server.ts";
import { pool } from "../db/client.ts";

const app = createServer();

afterAll(async () => {
  await pool.end();
});

describe("GET /api/stats/summary", () => {
  it("returns publishedCount", async () => {
    const res = await app.request("/api/stats/summary");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.publishedCount).toBe("number");
    expect(body.publishedCount).toBeGreaterThanOrEqual(0);
  });
});
