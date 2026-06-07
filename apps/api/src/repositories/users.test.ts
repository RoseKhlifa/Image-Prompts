import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/index.ts";
import {
  getUserForSubmission,
  incrementRejectedCount,
  setCommunityGuidelinesVersion,
  setRole,
} from "./users.ts";

const TEST_EMAIL_PREFIX = "users-repo-test-";

beforeEach(async () => {
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
});

let counter = 0;
async function makeUser(role: "user" | "moderator" | "admin" = "user") {
  counter += 1;
  const [row] = await db
    .insert(users)
    .values({ email: `${TEST_EMAIL_PREFIX}${counter}@example.com`, role })
    .returning();
  return row!;
}

describe("getUserForSubmission", () => {
  it("returns the minimal slice needed by submission handlers", async () => {
    const u = await makeUser();
    const r = await getUserForSubmission(u.id);
    expect(r).not.toBeNull();
    expect(r!.id).toBe(u.id);
    expect(r!.role).toBe("user");
    expect(r!.communityGuidelinesVersion).toBe(0);
    expect(r!.dailySubmissionCount).toBe(0);
    expect(r!.rejectedCount).toBe(0);
  });

  it("returns null for an unknown id", async () => {
    const r = await getUserForSubmission("00000000-0000-0000-0000-000000000000");
    expect(r).toBeNull();
  });
});

describe("incrementRejectedCount", () => {
  it("adds 1 to rejectedCount", async () => {
    const u = await makeUser();
    await incrementRejectedCount(u.id);
    await incrementRejectedCount(u.id);
    const [reread] = await db.select().from(users).where(eq(users.id, u.id));
    expect(reread!.rejectedCount).toBe(2);
  });
});

describe("setCommunityGuidelinesVersion", () => {
  it("updates the version field", async () => {
    const u = await makeUser();
    await setCommunityGuidelinesVersion(u.id, 2);
    const [reread] = await db.select().from(users).where(eq(users.id, u.id));
    expect(reread!.communityGuidelinesVersion).toBe(2);
  });
});

describe("setRole", () => {
  it("updates the role field", async () => {
    const u = await makeUser();
    await setRole(u.id, "admin");
    const [reread] = await db.select().from(users).where(eq(users.id, u.id));
    expect(reread!.role).toBe("admin");
  });
});
