const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Sign the user out of Auth.js properly.
 *
 * Auth.js's POST /api/auth/signout requires a CSRF token in the request body.
 * The flow:
 *   1. GET /api/auth/csrf → { csrfToken }
 *   2. POST /api/auth/signout with form-urlencoded body { csrfToken, callbackUrl }
 *   3. Server destroys the session row and clears the cookie
 *
 * Returns true on success, false on any failure (caller should still invalidate
 * the session query cache regardless).
 */
export async function signOut(callbackUrl: string = "/"): Promise<boolean> {
  try {
    const csrfRes = await fetch(`${API_URL}/api/auth/csrf`, { credentials: "include" });
    if (!csrfRes.ok) return false;
    const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

    const formBody = new URLSearchParams({ csrfToken, callbackUrl }).toString();
    const signoutRes = await fetch(`${API_URL}/api/auth/signout`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody,
    });
    return signoutRes.ok;
  } catch {
    return false;
  }
}
