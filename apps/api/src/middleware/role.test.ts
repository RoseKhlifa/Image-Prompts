import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { requireRole } from "./role.ts";

function buildApp(role: string | null) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (role === null) {
      // simulate unauthenticated
      (c as unknown as { set: (k: string, v: unknown) => void }).set("authUser", null);
    } else {
      (c as unknown as { set: (k: string, v: unknown) => void }).set(
        "authUser",
        { session: { user: { id: "u1", role } } },
      );
    }
    await next();
  });
  app.use("/admin/*", requireRole("admin", "moderator"));
  app.get("/admin/ping", (c) => c.json({ ok: true }));
  return app;
}

describe("requireRole", () => {
  it("allows admin", async () => {
    const res = await buildApp("admin").request("/admin/ping");
    expect(res.status).toBe(200);
  });
  it("allows moderator", async () => {
    const res = await buildApp("moderator").request("/admin/ping");
    expect(res.status).toBe(200);
  });
  it("rejects user with 403", async () => {
    const res = await buildApp("user").request("/admin/ping");
    expect(res.status).toBe(403);
  });
  it("rejects unauthenticated with 403", async () => {
    const res = await buildApp(null).request("/admin/ping");
    expect(res.status).toBe(403);
  });
  it("rejects an unknown role with 403", async () => {
    const res = await buildApp("nobody").request("/admin/ping");
    expect(res.status).toBe(403);
  });
});
