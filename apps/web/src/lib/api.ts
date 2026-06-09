import type { Locale } from "@ip/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type FetchOptions = RequestInit & {
  locale?: Locale;
  query?: Record<string, string | number | boolean | undefined | null>;
};

function buildUrl(path: string, query?: FetchOptions["query"]): string {
  const url = new URL(path, API_URL || window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { locale, query, headers, ...rest } = options;
  const url = buildUrl(path, query);

  // Build headers via the Headers class so duplicate keys with different
  // cases (e.g. "Content-Type" vs "content-type") merge into a single
  // canonical entry. Passing a plain-object init to fetch with mixed-case
  // duplicates resulted in some browsers sending malformed Content-Type
  // values, which made @hono/zod-validator on the server see an empty body
  // — verified 2026-06-09 on /api/translate and /api/owner/settings.
  const h = new Headers();
  h.set("Accept", "application/json");
  if (locale) h.set("X-Locale", locale);
  // Don't override Content-Type when sending FormData — the browser sets it
  // automatically with the multipart boundary string.
  if (rest.body && !(rest.body instanceof FormData)) {
    h.set("Content-Type", "application/json");
  }
  if (headers) {
    const incoming = headers instanceof Headers ? headers : new Headers(headers as HeadersInit);
    incoming.forEach((value, key) => h.set(key, value));
  }

  const res = await fetch(url, {
    credentials: "include",
    ...rest,
    headers: h,
  });

  if (!res.ok) {
    let payload: { error?: string; message?: string; fields?: Record<string, string> } = {};
    try {
      payload = await res.json();
    } catch {
      // non-JSON error response
    }
    throw new ApiError(
      res.status,
      payload.error ?? `http_${res.status}`,
      payload.message ?? res.statusText,
      payload.fields,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
