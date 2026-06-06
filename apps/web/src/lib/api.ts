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
  const res = await fetch(url, {
    credentials: "include",
    ...rest,
    headers: {
      Accept: "application/json",
      ...(locale ? { "X-Locale": locale } : {}),
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
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
