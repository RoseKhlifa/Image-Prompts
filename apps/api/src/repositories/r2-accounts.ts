import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { r2Accounts } from "../db/schema/index.ts";

export async function listR2PoolPublic() {
  const rows = await db
    .select({
      id: r2Accounts.id,
      publicUrl: r2Accounts.publicUrl,
    })
    .from(r2Accounts)
    .where(and(eq(r2Accounts.enabled, true), isNull(r2Accounts.deletedAt)))
    .orderBy(asc(r2Accounts.createdAt));
  return rows;
}
