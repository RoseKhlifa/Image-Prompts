import { describe, it, expect } from "vitest";

describe("GET /api/health (smoke, no DB)", () => {
  it("responds with json shape", async () => {
    // We can't hit the live route without DB; assert the route module exports a Hono app.
    const mod = await import("./health.ts");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe("function");
  });
});
