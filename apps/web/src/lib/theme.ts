import { type ThemeMode } from "@ip/shared";

export const THEME_STORAGE_KEY = "ip.theme";

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Compute whether the dark class should be applied for the given preference.
 */
export function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return systemPrefersDark();
}

export function applyTheme(mode: ThemeMode) {
  const dark = resolveDark(mode);
  const cls = document.documentElement.classList;
  if (dark) cls.add("dark");
  else cls.remove("dark");
}

export function persistTheme(mode: ThemeMode) {
  try {
    if (mode === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  } catch {
    // ignore
  }
}

export function readPersistedTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // ignore
  }
  return "system";
}
