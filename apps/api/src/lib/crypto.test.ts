import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encryptSecret, decryptSecret } from "./crypto.ts";

const ORIGINAL_ENV = { ...process.env };

beforeAll(() => {
  // 64 hex chars = 32 bytes = 256 bits
  process.env.R2_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("crypto: encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext secret", () => {
    const plain = "super-secret-r2-key-12345";
    const ct = encryptSecret(plain);
    expect(typeof ct).toBe("string");
    expect(ct.length).toBeGreaterThan(0);
    expect(decryptSecret(ct)).toBe(plain);
  });

  it("uses a fresh IV per call so two encryptions of the same plaintext differ", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same");
    expect(decryptSecret(b)).toBe("same");
  });

  it("rejects ciphertext that is too short (< 28 bytes)", () => {
    expect(() => decryptSecret("AAAA")).toThrow();
  });

  it("rejects ciphertext whose auth tag has been tampered with", () => {
    const ct = encryptSecret("hello");
    const raw = Buffer.from(ct, "base64");
    raw[14]! ^= 0xff; // flip a bit inside the auth tag region (12..28)
    const bad = raw.toString("base64");
    expect(() => decryptSecret(bad)).toThrow();
  });

  it("rejects ciphertext encrypted under a different key", () => {
    const ct = encryptSecret("hello");
    process.env.R2_ENCRYPTION_KEY =
      "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
    expect(() => decryptSecret(ct)).toThrow();
    // restore for subsequent tests
    process.env.R2_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });
});
