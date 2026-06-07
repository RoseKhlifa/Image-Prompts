import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/index.ts";
import { promoteIfAdminEmail } from "./index.ts";

const SAVED = { ...process.env };
const TEST_EMAIL_PREFIX = "admin-promote-test-";

beforeEach(async () => {
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
});

afterEach(async () => {
  process.env = { ...SAVED };
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%`));
});

async function makeUser(email: string, role: "user" | "moderator" | "admin" = "user") {
  const [u] = await db
    .insert(users)
    .values({ email, role })
    .returning();
  return u!;
}

describe("promoteIfAdminEmail", () => {
  it("promotes role=user to role=admin when email is in ADMIN_EMAILS", async () => {
    process.env.ADMIN_EMAILS = `${TEST_EMAIL_PREFIX}you@x.com, ${TEST_EMAIL_PREFIX}other@x.com`;
    const u = await makeUser(`${TEST_EMAIL_PREFIX}you@x.com`);
    const newRole = await promoteIfAdminEmail(u.id, `${TEST_EMAIL_PREFIX}you@x.com`, "user");
    expect(newRole).toBe("admin");
    const [reread] = await db.select().from(users).where(eq(users.id, u.id));
    expect(reread!.role).toBe("admin");
  });

  it("is case-insensitive on email", async () => {
    process.env.ADMIN_EMAILS = `${TEST_EMAIL_PREFIX}You@Example.com`;
    const u = await makeUser(`${TEST_EMAIL_PREFIX}you@example.com`);
    const newRole = await promoteIfAdminEmail(u.id, `${TEST_EMAIL_PREFIX}you@example.com`, "user");
    expect(newRole).toBe("admin");
  });

  it("does not touch role=moderator or role=admin", async () => {
    process.env.ADMIN_EMAILS = `${TEST_EMAIL_PREFIX}you@x.com`;
    const u = await makeUser(`${TEST_EMAIL_PREFIX}you@x.com`, "moderator");
    const newRole = await promoteIfAdminEmail(u.id, `${TEST_EMAIL_PREFIX}you@x.com`, "moderator");
    expect(newRole).toBe("moderator");
    const [reread] = await db.select().from(users).where(eq(users.id, u.id));
    expect(reread!.role).toBe("moderator");
  });

  it("noop when ADMIN_EMAILS is empty", async () => {
    process.env.ADMIN_EMAILS = "";
    const u = await makeUser(`${TEST_EMAIL_PREFIX}you@x.com`);
    const newRole = await promoteIfAdminEmail(u.id, `${TEST_EMAIL_PREFIX}you@x.com`, "user");
    expect(newRole).toBe("user");
  });

  it("noop when ADMIN_EMAILS unset", async () => {
    delete process.env.ADMIN_EMAILS;
    const u = await makeUser(`${TEST_EMAIL_PREFIX}you@x.com`);
    const newRole = await promoteIfAdminEmail(u.id, `${TEST_EMAIL_PREFIX}you@x.com`, "user");
    expect(newRole).toBe("user");
  });

  it("noop when email is not in the list", async () => {
    process.env.ADMIN_EMAILS = `${TEST_EMAIL_PREFIX}alice@x.com`;
    const u = await makeUser(`${TEST_EMAIL_PREFIX}bob@x.com`);
    const newRole = await promoteIfAdminEmail(u.id, `${TEST_EMAIL_PREFIX}bob@x.com`, "user");
    expect(newRole).toBe("user");
  });

  it("noop when email is null/missing", async () => {
    process.env.ADMIN_EMAILS = `${TEST_EMAIL_PREFIX}anyone@x.com`;
    const u = await makeUser(`${TEST_EMAIL_PREFIX}ghost@x.com`);
    const newRole = await promoteIfAdminEmail(u.id, null, "user");
    expect(newRole).toBe("user");
  });
});
