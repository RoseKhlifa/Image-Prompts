import { describe, it, expect } from "vitest";
import { getOwnerDashboard } from "./owner-stats.ts";

describe("owner-stats repository", () => {
  it("returns dashboard payload with all top-level fields", async () => {
    const r = await getOwnerDashboard();
    expect(typeof r.metrics.publishedPrompts).toBe("number");
    expect(typeof r.metrics.totalUsers).toBe("number");
    expect(typeof r.metrics.pendingSubmissions).toBe("number");
    expect(typeof r.metrics.totalViews).toBe("number");
    expect(typeof r.metrics.totalLikes).toBe("number");
    expect(typeof r.metrics.totalFavorites).toBe("number");
    expect(typeof r.metrics.totalSubmissions).toBe("number");
    expect(typeof r.metrics.totalR2UsedBytes).toBe("number");
    expect(Array.isArray(r.recentActivity)).toBe(true);
  });

  it("publishedPrompts is non-negative", async () => {
    const r = await getOwnerDashboard();
    expect(r.metrics.publishedPrompts).toBeGreaterThanOrEqual(0);
  });

  it("recentActivity items have required shape", async () => {
    const r = await getOwnerDashboard();
    for (const a of r.recentActivity) {
      expect(typeof a.id).toBe("string");
      expect(typeof a.action).toBe("string");
      expect(a.createdAt instanceof Date).toBe(true);
      // actorId/targetType/targetId can be null
    }
  });
});
