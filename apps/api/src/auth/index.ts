import { initAuthConfig } from "@hono/auth-js";
import Google from "@auth/core/providers/google";
import GitHub from "@auth/core/providers/github";
import type { Provider } from "@auth/core/providers";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "../db/client.ts";
import { accounts, sessions, users, verificationTokens } from "../db/schema/auth.ts";
import { env } from "../env.ts";

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
        (session.user as { role?: string }).role =
          (user as { role?: string }).role ?? "user";
      }
      return session;
    },
  },
  trustHost: true,
}));
