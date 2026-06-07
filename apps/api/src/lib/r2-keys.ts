import { randomUUID } from "node:crypto";

const MIME_MAP = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type AllowedMime = keyof typeof MIME_MAP;

export function mimeToExt(mime: string): "jpg" | "png" | "webp" {
  const ext = (MIME_MAP as Record<string, "jpg" | "png" | "webp">)[mime];
  if (!ext) throw new Error(`unsupported MIME: ${mime}`);
  return ext;
}

export function buildSubmissionKey(userId: string, ext: string): string {
  return `submissions/${userId}/${randomUUID()}.${ext.toLowerCase()}`;
}

export function buildPromptKey(promptId: string, index: number, ext: string): string {
  return `prompts/${promptId}/${index}.${ext.toLowerCase()}`;
}
