import { ProxyAgent, setGlobalDispatcher } from "undici";

/**
 * Configure Node's global `fetch` dispatcher to honour HTTPS_PROXY / HTTP_PROXY.
 *
 * Why: Node 22's global `fetch` (undici) does NOT read proxy env vars by
 * default. Auth.js needs to reach OAuth provider endpoints (Google's discovery
 * document, GitHub's authorize URL, etc.); on networks where direct egress is
 * blocked the OAuth flow fails with `UND_ERR_CONNECT_TIMEOUT` and Auth.js
 * surfaces it as `?error=Configuration`. This helper installs a global
 * ProxyAgent so those fetches go through the operator's local proxy.
 *
 * Lookup order (case-insensitive — Windows often exposes lowercase, Unix
 * upper-case):
 *   1. HTTPS_PROXY / https_proxy
 *   2. HTTP_PROXY  / http_proxy
 *
 * Only affects undici / global `fetch`. `pg` (TCP socket) and `@aws-sdk` (its
 * own HTTPS client) are unaffected — DB pool and any R2 traffic continue to
 * talk directly. We don't do any in-process `fetch` to localhost, so NO_PROXY
 * support is intentionally omitted (YAGNI).
 */
export function setupProxyDispatcher(): void {
  const proxyUrl =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;

  if (!proxyUrl) return;

  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[proxy] global fetch dispatcher → ${proxyUrl}`);
}
