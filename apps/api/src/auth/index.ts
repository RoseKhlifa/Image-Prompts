import { initAuthConfig } from "@hono/auth-js";
import Google from "@auth/core/providers/google";
import GitHub from "@auth/core/providers/github";
import type { Provider } from "@auth/core/providers";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { accounts, sessions, users, verificationTokens } from "../db/schema/auth.ts";
import { env } from "../env.ts";

/**
 * If the user's email matches ADMIN_EMAILS and they're currently 'user',
 * promote them to 'admin' in the database and return the new role string.
 * Returns the existing role unchanged otherwise.
 *
 * Used by the Auth.js session callback so newly-onboarded admins flip on
 * their next sign-in. Idempotent: writes only on the first promotion; never
 * re-writes for users already at moderator/admin.
 */
export async function promoteIfAdminEmail(
  userId: string,
  email: string | null | undefined,
  currentRole: string,
): Promise<string> {
  if (!email) return currentRole;
  const raw = process.env.ADMIN_EMAILS ?? "";
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return currentRole;
  if (!list.includes(email.toLowerCase())) return currentRole;
  if (currentRole !== "user") return currentRole;
  await db.update(users).set({ role: "admin" }).where(eq(users.id, userId));
  return "admin";
}

/**
 * True iff the email matches OWNER_EMAILS (case-insensitive). Pure read of
 * env at call time — no DB roundtrip. Empty env = no owners.
 */
export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.OWNER_EMAILS ?? "";
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  return list.includes(email.toLowerCase());
}

function buildEnabledProviders(): Provider[] {
  const out: Provider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    out.push(
      Google({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      }),
    );
  } else {
    console.warn("[auth] provider google disabled: missing creds");
  }
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    out.push(
      GitHub({
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      }),
    );
  } else {
    console.warn("[auth] provider github disabled: missing creds");
  }
  return out;
}

// Built once at module import — providers and warn-logs do NOT repeat per request.
const PROVIDERS: Provider[] = buildEnabledProviders();

export const authConfig = initAuthConfig(() => ({
  secret: env.AUTH_SECRET,
  // ★ M3-T6: @auth/core defaults basePath to "/auth"; we mount the handler at
  // /api/auth/*, so we must override or Auth.js throws UnknownAction when it
  // tries to parse the action segment from request paths like /api/auth/session.
  basePath: "/api/auth",
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  providers: PROVIDERS,
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        let role = (user as { role?: string }).role ?? "user";
        role = await promoteIfAdminEmail(user.id, user.email, role);
        (session.user as { role?: string }).role = role;
        // ★ M4 Task 26: expose the user's accepted community-guidelines version
        // so the SPA's useCommunityGuidelinesGate hook can decide whether to
        // show the acceptance modal before allowing a submission.
        (session.user as { communityGuidelinesVersion?: number }).communityGuidelinesVersion =
          (user as { communityGuidelinesVersion?: number }).communityGuidelinesVersion ?? 0;
        // ★ M10a: expose owner flag derived from OWNER_EMAILS env. We don't
        // ship env to the client — the session is the single source of truth.
        // Owner is a strict subset of admin (B-scheme).
        (session.user as { isOwner?: boolean }).isOwner =
          isOwnerEmail(user.email) && role === "admin";
      }
      return session;
    },
    /**
     * After OAuth callback succeeds, Auth.js needs to decide where to send the
     * browser. Default policy is "only same-origin as AUTH_URL", which in dev
     * is `http://localhost:3000` (the API) — but our SPA lives on
     * `http://localhost:5173`. Explicitly allow the SITE_URL origin (the web
     * app) plus any same-host path. Falls back to SITE_URL root on anything
     * unfamiliar so we never strand the user on the API origin.
     */
    async redirect({ url, baseUrl }) {
      try {
        const target = new URL(url, baseUrl);
        const site = new URL(env.SITE_URL);
        if (target.origin === site.origin) return target.toString();
        if (target.origin === baseUrl) return target.toString();
      } catch {
        /* malformed url — fall through */
      }
      return env.SITE_URL;
    },
  },
  trustHost: true,
}));
