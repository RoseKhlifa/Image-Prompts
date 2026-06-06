import { useTranslation } from "react-i18next";
import { Sun, Moon, Monitor } from "lucide-react";
import { type ThemeMode } from "@ip/shared";
import { useUiStore } from "../state/uiStore";

const ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export default function ThemeSwitcher() {
  const { t } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const modes: ThemeMode[] = ["light", "dark", "system"];

  return (
    <div
      role="group"
      aria-label={t("common.theme")}
      className="inline-flex rounded-pill border border-border-soft bg-surface p-0.5"
    >
      {modes.map((mode) => {
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
  );
}
