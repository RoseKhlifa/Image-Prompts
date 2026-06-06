import { createMiddleware } from "hono/factory";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@ip/shared";

type LocaleVars = { locale: Locale };

/**
 * Extracts requested locale from the X-Locale header or ?locale query param.
 * Defaults to zh. Used by API routes that need to format bilingual content.
 * (Path locale prefixes belong to the web app router, not the API.)
 */
export const localeMiddleware = createMiddleware<{ Variables: LocaleVars }>(async (c, next) => {
  const fromHeader = c.req.header("x-locale");
  const fromQuery = c.req.query("locale");
  const candidate = fromHeader ?? fromQuery ?? "";
  c.set("locale", isLocale(candidate) ? candidate : DEFAULT_LOCALE);
  await next();
});

export type { LocaleVars };
