import { and, eq, sql } from "drizzle-orm";
import { generateBase62Token } from "@ip/shared";
import type { ImportTokenPayload } from "@ip/shared";
import { db } from "../db/client.ts";
import { importTokens } from "../db/schema/system.ts";
import { prompts } from "../db/schema/prompts.ts";

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type CreateImportTokenInput = {
  userId: string;
  payload: ImportTokenPayload;
  promptId?: string;
  ip?: string;
};

export async function createImportToken(input: CreateImportTokenInput) {
  const token = generateBase62Token(8);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db.insert(importTokens).values({
    token,
    userId: input.userId,
    payload: input.payload,
    promptId: input.promptId,
    expiresAt,
    createdIp: input.ip,
  });
  return { token, expiresAt };
}

/**
 * Discriminated error type so the route layer can map to specific HTTP codes
 * without parsing free-text messages.
 */
export type ConsumeErrorCode = "token_not_found" | "token_used" | "token_expired";

export class ConsumeError extends Error {
  constructor(public readonly code: ConsumeErrorCode) {
    super(code);
    this.name = "ConsumeError";
  }
}

export async function consumeImportToken(token: string): Promise<ImportTokenPayload> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(importTokens)
      .where(eq(importTokens.token, token))
      .for("update");

    if (!row) throw new ConsumeError("token_not_found");
    if (row.used) throw new ConsumeError("token_used");
    if (row.expiresAt < new Date()) throw new ConsumeError("token_expired");

    const updated = await tx
      .update(importTokens)
      .set({ used: true, usedAt: new Date() })
      .where(and(eq(importTokens.token, token), eq(importTokens.used, false)))
      .returning({ token: importTokens.token });

    if (updated.length === 0) throw new ConsumeError("token_used");

    if (row.promptId) {
      await tx
        .update(prompts)
        .set({ sendCount: sql`${prompts.sendCount} + 1` })
        .where(eq(prompts.id, row.promptId));
    }

    return row.payload as ImportTokenPayload;
  });
}
