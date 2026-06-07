import { db } from "../db/client.ts";
import { auditLog } from "../db/schema/index.ts";

type RecordInput = {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  /** Optional transaction handle so callers can chain audit with other ops. */
  tx?: Parameters<Parameters<typeof db.transaction>[0]>[0];
};

export async function recordAudit(input: RecordInput): Promise<void> {
  const conn = input.tx ?? db;
  await conn.insert(auditLog).values({
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    payload: input.payload,
  });
}
