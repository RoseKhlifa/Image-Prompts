import { useTranslation } from "react-i18next";
import { Sun, Moon, Monitor } from "lucide-react";
import { type ThemeMode } from "@ip/shared";
import { useUiStore } from "../state/uiStore";

const ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const MODES: ThemeMode[] = ["light", "dark", "system"];

export default function ThemeSwitcher() {
  const { t } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const ActiveIcon = ICONS[theme];

  // Mobile (single button cycling Sun → Moon → Monitor) and desktop (3-button
  // group) live in the same component because the desktop variant is hidden
  // below `md:` and the mobile one above. Cycling on mobile keeps the header
  // narrow: 1 button instead of 3, no popover state to manage.
  function cycle() {
    const idx = MODES.indexOf(theme);
    const next = MODES[(idx + 1) % MODES.length] as ThemeMode;
    setTheme(next);
  }

  return (
    <>
      {/* Mobile: single cycling button. */}
      <button
        type="button"
        onClick={cycle}
        aria-label={t(`theme_modes.${theme}`)}
        title={t(`theme_modes.${theme}`)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-pill border border-border-soft bg-surface text-ink-muted hover:text-ink md:hidden"
      >
        <ActiveIcon size={14} aria-hidden />
      </button>

      {/* Desktop: 3-button row. */}
      <div
        role="group"
        aria-label={t("common.theme")}
        className="hidden rounded-pill border border-border-soft bg-surface p-0.5 md:inline-flex"
      >
        {MODES.map((mode) => {
          const Icon = ICONS[mode];
          const isActive = theme === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={isActive}
              aria-label={t(`theme_modes.${mode}`)}
              title={t(`theme_modes.${mode}`)}
              onClick={() => setTheme(mode)}
              className={[
                "rounded-pill p-1.5 transition-colors",
                isActive ? "bg-accent text-white" : "text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              <Icon size={14} aria-hidden />
            </button>
          );
        })}
      </div>
    </>
  );
}
