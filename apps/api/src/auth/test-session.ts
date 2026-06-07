/**
 * Test helper: directly INSERT a sessions row and return the cookie value that
 * @hono/auth-js will accept on subsequent requests.
 *
 * Real OAuth is too expensive to run in unit tests, so we sidestep it: Auth.js
 * looks up the session by cookie value (the `session_token` column), so we can
 * fabricate one.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { sessions, users } from "../db/schema/auth.ts";

export type TestSession = {
  userId: string;
  email: string;
  sessionToken: string;
  cookie: string;
};

const COOKIE_NAME = "authjs.session-token";

export async function createTestSession(input?: {
  email?: string;
  name?: string;
}): Promise<TestSession> {
  const email = input?.email ?? `test-${randomUUID()}@example.com`;

  let userId: string;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) {
    userId = existing.id;
  } else {
    const [inserted] = await db
      .insert(users)
      .values({ email, name: input?.name ?? "Test User" })
      .returning({ id: users.id });
    userId = inserted!.id;
  }

  const sessionToken = randomUUID();
  await db.insert(sessions).values({
    sessionToken,
    userId,
    expires: new Date(Date.now() + 60 * 60 * 1000),
  });

  return {
    userId,
    email,
    sessionToken,
    cookie: `${COOKIE_NAME}=${sessionToken}`,
  };
}

export async function cleanupTestSession(token: string) {
  await db.delete(sessions).where(eq(sessions.sessionToken, token));
}
