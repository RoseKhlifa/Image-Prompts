/**
 * M10b W4.1: Translator library.
 *
 * Calls an OpenAI /responses-compatible endpoint (compatible with relays
 * like OneAPI / NewAPI). Config is loaded from site_settings (translator.*
 * keys); errors are typed and surfaced via TranslateException so the route
 * layer can map them to HTTP responses without sniffing strings.
 *
 * The route layer (W4.2) wraps this with a per-user-per-hour rate limiter
 * (createRateLimiter from lib/rate-limit.ts). This module itself is pure
 * w.r.t. rate limiting — it doesn't know about users.
 */
import { getSettingsByPrefix } from "../repositories/site-settings.ts";

export type Locale = "zh" | "en";

export type TranslateInput = {
  text: string;
  fromLocale: Locale;
  toLocale: Locale;
};

export type TranslatorConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string; // empty string means use FALLBACK_SYSTEM_PROMPT
  maxCharsPerRequest: number;
  rateLimitPerUserHour: number;
};

export type TranslateError =
  | { code: "translator_disabled" }
  | { code: "translator_unconfigured" } // api_key empty
  | { code: "text_too_long"; maxChars: number }
  | { code: "rate_limited" } // emitted by route layer, kept here for type completeness
  | { code: "upstream_error"; status: number; body?: string }
  | { code: "network_error"; error: string }
  | { code: "empty_response" };

export class TranslateException extends Error {
  constructor(public detail: TranslateError) {
    super(detail.code);
    this.name = "TranslateException";
  }
}

/**
 * Built-in fallback prompt used when the owner hasn't customised
 * translator.system_prompt. Keeps technical tags / weights / negative
 * prefixes intact, which is the whole point of having a domain-specific
 * translator instead of a generic one.
 */
const FALLBACK_SYSTEM_PROMPT = `You are a translator helping users convert AI image-generation prompts between Chinese and English.

Output ONLY the translated text — no explanation, no quotes, no Markdown.
Preserve technical terms (LoRA names, model names, aspect ratios like 1:1 or 16:9) verbatim.
Keep stylistic tags and weights (e.g. "(token:1.2)") intact.
Keep negative prefixes ("--no" / "negative:") intact.`;

/**
 * Read translator.* keys from site_settings; coerce types defensively
 * (a wrong-typed value falls back to the code default so a bad seed can't
 * crash the route layer).
 */
export async function loadTranslatorConfig(): Promise<TranslatorConfig> {
  const m = await getSettingsByPrefix("translator.");
  return {
    enabled:
      typeof m.get("translator.enabled") === "boolean"
        ? (m.get("translator.enabled") as boolean)
        : false,
    baseUrl:
      typeof m.get("translator.base_url") === "string"
        ? (m.get("translator.base_url") as string)
        : "https://api.openai.com/v1",
    apiKey:
      typeof m.get("translator.api_key") === "string"
        ? (m.get("translator.api_key") as string)
        : "",
    model:
      typeof m.get("translator.model") === "string"
        ? (m.get("translator.model") as string)
        : "gpt-4o-mini",
    systemPrompt:
      typeof m.get("translator.system_prompt") === "string"
        ? (m.get("translator.system_prompt") as string)
        : "",
    maxCharsPerRequest:
      typeof m.get("translator.max_chars_per_request") === "number"
        ? (m.get("translator.max_chars_per_request") as number)
        : 2000,
    rateLimitPerUserHour:
      typeof m.get("translator.rate_limit_per_user_hour") === "number"
        ? (m.get("translator.rate_limit_per_user_hour") as number)
        : 20,
  };
}

/**
 * Translate a single text snippet between zh and en.
 *
 * `fetchImpl` is injected so tests can mock the upstream without monkey-
 * patching globalThis.fetch. In production, callers leave it as the
 * default (global fetch).
 *
 * Error contract: throws TranslateException on every failure mode. Never
 * returns null/undefined for the translated string.
 */
export async function translate(
  input: TranslateInput,
  config: TranslatorConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ translated: string }> {
  if (!config.enabled) {
    throw new TranslateException({ code: "translator_disabled" });
  }
  if (!config.apiKey) {
    throw new TranslateException({ code: "translator_unconfigured" });
  }
  if (input.text.length > config.maxCharsPerRequest) {
    throw new TranslateException({
      code: "text_too_long",
      maxChars: config.maxCharsPerRequest,
    });
  }

  const systemPrompt = config.systemPrompt || FALLBACK_SYSTEM_PROMPT;
  const directionHint = `Translate the following from ${
    input.fromLocale === "zh" ? "Chinese" : "English"
  } to ${input.toLocale === "zh" ? "Chinese" : "English"}.`;

  // baseUrl may or may not end in /; normalise once before concatenating
  // so we never produce //responses.
  const url = `${config.baseUrl.replace(/\/$/, "")}/responses`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: [
          { role: "system", content: `${systemPrompt}\n\n${directionHint}` },
          { role: "user", content: input.text },
        ],
      }),
    });
  } catch (e) {
    throw new TranslateException({
      code: "network_error",
      error: e instanceof Error ? e.message : String(e),
    });
  }

  if (!res.ok) {
    let body = "";
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      // ignore — body capture is best-effort
    }
    throw new TranslateException({
      code: "upstream_error",
      status: res.status,
      body,
    });
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new TranslateException({
      code: "upstream_error",
      status: res.status,
      body: "non-json response",
    });
  }

  const text = extractResponseText(parsed);
  if (!text || !text.trim()) {
    throw new TranslateException({ code: "empty_response" });
  }
  return { translated: text.trim() };
}

/**
 * Best-effort extraction of the assistant's text from a /responses-style
 * JSON envelope. We try three shapes in order:
 *   1. Canonical OpenAI /responses: output[0].content[0].text (string or {value})
 *   2. Chat-completions: choices[0].message.content (some relays return this
 *      when you call /responses)
 *   3. Top-level output_text (the SDK helper field)
 *
 * Returns null when none of those produced a string — the caller treats
 * that as empty_response.
 */
function extractResponseText(json: unknown): string | null {
  if (json === null || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;

  // 1. Canonical: { output: [{ content: [{ text: "..." }] }] }
  if (Array.isArray(j.output) && j.output[0]) {
    const first = j.output[0] as Record<string, unknown>;
    if (Array.isArray(first.content) && first.content[0]) {
      const c = first.content[0] as Record<string, unknown>;
      if (typeof c.text === "string") return c.text;
      if (
        c.text !== null &&
        typeof c.text === "object" &&
        "value" in (c.text as Record<string, unknown>)
      ) {
        const tv = (c.text as Record<string, unknown>).value;
        if (typeof tv === "string") return tv;
      }
    }
  }

  // 2. Chat-completions fallback: { choices: [{ message: { content: "..." } }] }
  if (Array.isArray(j.choices) && (j.choices as unknown[])[0]) {
    const choice = (j.choices as Array<Record<string, unknown>>)[0] as Record<
      string,
      unknown
    >;
    const msg = choice.message;
    if (msg && typeof msg === "object") {
      const content = (msg as Record<string, unknown>).content;
      if (typeof content === "string") return content;
    }
  }

  // 3. SDK convenience: { output_text: "..." }
  if (typeof j.output_text === "string") return j.output_text;

  return null;
}
