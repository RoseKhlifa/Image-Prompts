import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh.json";
import en from "./locales/en.json";
import { DEFAULT_LOCALE, type Locale } from "../lib/locale";

export async function initI18n(locale: Locale = DEFAULT_LOCALE) {
  await i18n.use(initReactI18next).init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });
  return i18n;
}

export async function changeLanguage(locale: Locale) {
  await i18n.changeLanguage(locale);
}

export default i18n;
