import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import {
  loadTranslatorConfig,
  translate,
  TranslateException,
  type TranslatorConfig,
} from "./translator.ts";
import { setSetting } from "../repositories/site-settings.ts";
import { db } from "../db/client.ts";
import { siteSettings } from "../db/schema/index.ts";

/**
 * Helper: build a complete TranslatorConfig with sensible defaults so each
 * test only specifies the fields it cares about.
 */
function cfg(overrides: Partial<TranslatorConfig> = {}): TranslatorConfig {
  return {
    enabled: true,
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    systemPrompt: "",
    maxCharsPerRequest: 2000,
    rateLimitPerUserHour: 20,
    ...overrides,
  };
}

describe("loadTranslatorConfig", () => {
  // Restore seed values after the suite so a mid-suite crash can't leave
  // poisoned translator.* rows that break siblings.
  afterAll(async () => {
    await setSetting("translator.enabled", false, null);
    await setSetting("translator.base_url", "https://api.openai.com/v1", null);
    await setSetting("translator.api_key", "", null);
    await setSetting("translator.model", "gpt-4o-mini", null);
    await setSetting("translator.system_prompt", "", null);
    await setSetting("translator.max_chars_per_request", 2000, null);
    await setSetting("translator.rate_limit_per_user_hour", 20, null);
  });

  it("reads all translator.* keys from site_settings", async () => {
    await setSetting("translator.enabled", true, null);
    await setSetting("translator.base_url", "https://relay.example.com/v1", null);
    await setSetting("translator.api_key", "sk-xyz", null);
    await setSetting("translator.model", "gpt-4o", null);
    await setSetting("translator.system_prompt", "custom prompt", null);
    await setSetting("translator.max_chars_per_request", 1500, null);
    await setSetting("translator.rate_limit_per_user_hour", 30, null);

    const config = await loadTranslatorConfig();
    expect(config.enabled).toBe(true);
    expect(config.baseUrl).toBe("https://relay.example.com/v1");
    expect(config.apiKey).toBe("sk-xyz");
    expect(config.model).toBe("gpt-4o");
    expect(config.systemPrompt).toBe("custom prompt");
    expect(config.maxCharsPerRequest).toBe(1500);
    expect(config.rateLimitPerUserHour).toBe(30);
  });

  it("falls back to defaults when keys missing", async () => {
    // Wipe rows so the loader has to use code defaults.
    await db.delete(siteSettings).where(eq(siteSettings.key, "translator.enabled"));
    await db.delete(siteSettings).where(eq(siteSettings.key, "translator.base_url"));
    await db.delete(siteSettings).where(eq(siteSettings.key, "translator.api_key"));
    await db.delete(siteSettings).where(eq(siteSettings.key, "translator.model"));
    await db.delete(siteSettings).where(eq(siteSettings.key, "translator.system_prompt"));
    await db
      .delete(siteSettings)
      .where(eq(siteSettings.key, "translator.max_chars_per_request"));
    await db
      .delete(siteSettings)
      .where(eq(siteSettings.key, "translator.rate_limit_per_user_hour"));

    const config = await loadTranslatorConfig();
    expect(config.enabled).toBe(false);
    expect(config.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.apiKey).toBe("");
    expect(config.model).toBe("gpt-4o-mini");
    expect(config.systemPrompt).toBe("");
    expect(config.maxCharsPerRequest).toBe(2000);
    expect(config.rateLimitPerUserHour).toBe(20);
  });
});

describe("translate", () => {
  it("throws translator_disabled when enabled=false", async () => {
    const config = cfg({ enabled: false });
    await expect(
      translate({ text: "hello", fromLocale: "en", toLocale: "zh" }, config),
    ).rejects.toMatchObject({
      detail: { code: "translator_disabled" },
    });
  });

  it("throws translator_unconfigured when apiKey is empty", async () => {
    const config = cfg({ apiKey: "" });
    await expect(
      translate({ text: "hello", fromLocale: "en", toLocale: "zh" }, config),
    ).rejects.toMatchObject({
      detail: { code: "translator_unconfigured" },
    });
  });

  it("throws text_too_long when text exceeds maxCharsPerRequest", async () => {
    const config = cfg({ maxCharsPerRequest: 5 });
    await expect(
      translate(
        { text: "way too many characters", fromLocale: "en", toLocale: "zh" },
        config,
      ),
    ).rejects.toMatchObject({
      detail: { code: "text_too_long", maxChars: 5 },
    });
  });

  it("happy path returns translated text (canonical /responses shape)", async () => {
    const config = cfg();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              content: [{ type: "output_text", text: "你好" }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const result = await translate(
      { text: "hello", fromLocale: "en", toLocale: "zh" },
      config,
      fakeFetch,
    );
    expect(result.translated).toBe("你好");
  });

  it("handles chat-completions choices[0].message.content fallback shape", async () => {
    const config = cfg();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "你好世界" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const result = await translate(
      { text: "hello world", fromLocale: "en", toLocale: "zh" },
      config,
      fakeFetch,
    );
    expect(result.translated).toBe("你好世界");
  });

  it("handles top-level output_text fallback shape", async () => {
    const config = cfg();
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ output_text: "hello there" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const result = await translate(
      { text: "你好", fromLocale: "zh", toLocale: "en" },
      config,
      fakeFetch,
    );
    expect(result.translated).toBe("hello there");
  });

  it("handles nested {text: {value}} variant inside content", async () => {
    const config = cfg();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              content: [{ type: "output_text", text: { value: "nested" } }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const result = await translate(
      { text: "x", fromLocale: "en", toLocale: "zh" },
      config,
      fakeFetch,
    );
    expect(result.translated).toBe("nested");
  });

  it("throws upstream_error on non-2xx status", async () => {
    const config = cfg();
    const fakeFetch: typeof fetch = async () =>
      new Response("rate limited by upstream", { status: 429 });
    await expect(
      translate({ text: "hello", fromLocale: "en", toLocale: "zh" }, config, fakeFetch),
    ).rejects.toMatchObject({
      detail: { code: "upstream_error", status: 429 },
    });
  });

  it("includes upstream body (truncated) in upstream_error detail", async () => {
    const config = cfg();
    const longBody = "x".repeat(1000);
    const fakeFetch: typeof fetch = async () =>
      new Response(longBody, { status: 500 });
    try {
      await translate(
        { text: "hello", fromLocale: "en", toLocale: "zh" },
        config,
        fakeFetch,
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TranslateException);
      const detail = (e as TranslateException).detail;
      expect(detail.code).toBe("upstream_error");
      if (detail.code === "upstream_error") {
        expect(detail.status).toBe(500);
        // Body should be truncated to <= 500 chars
        expect((detail.body ?? "").length).toBeLessThanOrEqual(500);
      }
    }
  });

  it("throws network_error when fetch throws", async () => {
    const config = cfg();
    const fakeFetch: typeof fetch = async () => {
      throw new Error("connection refused");
    };
    await expect(
      translate({ text: "hello", fromLocale: "en", toLocale: "zh" }, config, fakeFetch),
    ).rejects.toMatchObject({
      detail: { code: "network_error", error: "connection refused" },
    });
  });

  it("throws empty_response when translated text is empty/whitespace", async () => {
    const config = cfg();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text: "   " }] }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    await expect(
      translate({ text: "hello", fromLocale: "en", toLocale: "zh" }, config, fakeFetch),
    ).rejects.toMatchObject({
      detail: { code: "empty_response" },
    });
  });

  it("throws empty_response when shape is unrecognized", async () => {
    const config = cfg();
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ totally: "unknown" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await expect(
      translate({ text: "hello", fromLocale: "en", toLocale: "zh" }, config, fakeFetch),
    ).rejects.toMatchObject({
      detail: { code: "empty_response" },
    });
  });

  it("throws upstream_error when response body is not JSON", async () => {
    const config = cfg();
    const fakeFetch: typeof fetch = async () =>
      new Response("plain text not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    await expect(
      translate({ text: "hello", fromLocale: "en", toLocale: "zh" }, config, fakeFetch),
    ).rejects.toMatchObject({
      detail: { code: "upstream_error" },
    });
  });

  it("sends Bearer auth header and JSON body with model + input array", async () => {
    const config = cfg({ apiKey: "sk-secret", model: "test-model" });
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (input, init) => {
      capturedUrl = typeof input === "string" ? input : (input as URL).toString();
      capturedInit = init;
      return new Response(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text: "ok" }] }],
        }),
        { status: 200 },
      );
    };
    await translate(
      { text: "hello", fromLocale: "en", toLocale: "zh" },
      config,
      fakeFetch,
    );
    expect(capturedUrl).toBe("https://api.example.com/v1/responses");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-secret");
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(capturedInit?.body as string) as {
      model: string;
      input: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("test-model");
    expect(body.input).toHaveLength(2);
    expect(body.input[0]!.role).toBe("system");
    expect(body.input[1]!.role).toBe("user");
    expect(body.input[1]!.content).toBe("hello");
  });

  it("includes direction hint 'Chinese to English' when zh→en", async () => {
    const config = cfg();
    let capturedSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(init?.body as string) as {
        input: Array<{ role: string; content: string }>;
      };
      capturedSystem = body.input[0]!.content;
      return new Response(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text: "hi" }] }],
        }),
        { status: 200 },
      );
    };
    await translate(
      { text: "你好", fromLocale: "zh", toLocale: "en" },
      config,
      fakeFetch,
    );
    expect(capturedSystem).toContain("Chinese to English");
  });

  it("includes direction hint 'English to Chinese' when en→zh", async () => {
    const config = cfg();
    let capturedSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(init?.body as string) as {
        input: Array<{ role: string; content: string }>;
      };
      capturedSystem = body.input[0]!.content;
      return new Response(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text: "你好" }] }],
        }),
        { status: 200 },
      );
    };
    await translate(
      { text: "hello", fromLocale: "en", toLocale: "zh" },
      config,
      fakeFetch,
    );
    expect(capturedSystem).toContain("English to Chinese");
  });

  it("uses fallback system prompt when config.systemPrompt is empty", async () => {
    const config = cfg({ systemPrompt: "" });
    let capturedSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(init?.body as string) as {
        input: Array<{ role: string; content: string }>;
      };
      capturedSystem = body.input[0]!.content;
      return new Response(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text: "ok" }] }],
        }),
        { status: 200 },
      );
    };
    await translate(
      { text: "hello", fromLocale: "en", toLocale: "zh" },
      config,
      fakeFetch,
    );
    // Fallback mentions translation and the LoRA preservation rule.
    expect(capturedSystem).toContain("translator");
    expect(capturedSystem).toContain("LoRA");
  });

  it("uses custom systemPrompt when provided", async () => {
    const config = cfg({ systemPrompt: "Custom: be terse." });
    let capturedSystem = "";
    const fakeFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(init?.body as string) as {
        input: Array<{ role: string; content: string }>;
      };
      capturedSystem = body.input[0]!.content;
      return new Response(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text: "ok" }] }],
        }),
        { status: 200 },
      );
    };
    await translate(
      { text: "hello", fromLocale: "en", toLocale: "zh" },
      config,
      fakeFetch,
    );
    expect(capturedSystem).toContain("Custom: be terse.");
    // Direction hint should still be appended regardless.
    expect(capturedSystem).toContain("English to Chinese");
  });

  it("strips trailing slash from baseUrl before appending /responses", async () => {
    const config = cfg({ baseUrl: "https://api.example.com/v1/" });
    let capturedUrl = "";
    const fakeFetch: typeof fetch = async (input) => {
      capturedUrl = typeof input === "string" ? input : (input as URL).toString();
      return new Response(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text: "ok" }] }],
        }),
        { status: 200 },
      );
    };
    await translate(
      { text: "hello", fromLocale: "en", toLocale: "zh" },
      config,
      fakeFetch,
    );
    expect(capturedUrl).toBe("https://api.example.com/v1/responses");
  });

  it("trims surrounding whitespace from translated output", async () => {
    const config = cfg();
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          output: [{ content: [{ type: "output_text", text: "  hi  \n" }] }],
        }),
        { status: 200 },
      );
    const result = await translate(
      { text: "x", fromLocale: "en", toLocale: "zh" },
      config,
      fakeFetch,
    );
    expect(result.translated).toBe("hi");
  });
});
