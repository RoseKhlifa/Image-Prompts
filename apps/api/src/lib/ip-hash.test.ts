import { describe, it, expect } from "vitest";
import { hashIp } from "./ip-hash.ts";

describe("hashIp", () => {
  it("returns a 16-char lowercase hex string", () => {
    const out = hashIp("203.0.113.42", "test-secret-with-enough-chars-here");
    expect(out).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for the same ip + secret", () => {
    const a = hashIp("203.0.113.42", "secret");
    const b = hashIp("203.0.113.42", "secret");
    expect(a).toBe(b);
  });

  it("differs for different ips with same secret", () => {
    const a = hashIp("203.0.113.42", "secret");
    const b = hashIp("203.0.113.43", "secret");
    expect(a).not.toBe(b);
  });

  it("differs for same ip with different secrets (rainbow-table resistance)", () => {
    const a = hashIp("203.0.113.42", "secret-A");
    const b = hashIp("203.0.113.42", "secret-B");
    expect(a).not.toBe(b);
  });

  it("returns null for empty input", () => {
    expect(hashIp("", "secret")).toBeNull();
    expect(hashIp(null, "secret")).toBeNull();
    expect(hashIp(undefined, "secret")).toBeNull();
  });
});
