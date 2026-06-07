import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = IV_LEN + TAG_LEN;

function getKey(): Buffer {
  // Read process.env directly (not the cached env module) so mutations in
  // tests take effect. Production sets R2_ENCRYPTION_KEY once at startup and
  // never changes it; the Zod schema in env.ts validates it at boot so by
  // the time anything calls this, the value is known to be 64 hex chars.
  const hex = process.env.R2_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("R2_ENCRYPTION_KEY must be 64 hex characters");
  }
  return Buffer.from(hex, "hex");
}

/**
 * AES-256-GCM encrypt a UTF-8 string. Output is base64 of:
 *   [iv (12 bytes) | auth tag (16 bytes) | ciphertext]
 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * AES-256-GCM decrypt the base64 blob produced by encryptSecret. Throws on:
 *   - blob shorter than 28 bytes
 *   - auth tag mismatch (tampering, wrong key)
 */
export function decryptSecret(ciphertextB64: string): string {
  const buf = Buffer.from(ciphertextB64, "base64");
  if (buf.length < HEADER_LEN) {
    throw new Error("ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, HEADER_LEN);
  const ct = buf.subarray(HEADER_LEN);
  const dec = createDecipheriv("aes-256-gcm", getKey(), iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(ct), dec.final()]).toString("utf8");
}
