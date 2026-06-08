import { useTranslation } from "react-i18next";

type Stats = {
  publishedCount: number;
  totalViews: number;
  totalLikes: number;
  totalFavorites: number;
};

type Props = {
  stats: Stats;
  /** "full" = 4-column grid; "compact" = inline horizontal */
  variant?: "full" | "compact";
};

const ITEMS: ReadonlyArray<{ key: keyof Stats; labelKey: string }> = [
  { key: "publishedCount", labelKey: "stats.published" },
  { key: "totalViews", labelKey: "stats.views" },
  { key: "totalLikes", labelKey: "stats.likes" },
  { key: "totalFavorites", labelKey: "stats.favorites" },
];

export default function StatsCard({ stats, variant = "full" }: Props) {
  const { t } = useTranslation();
  if (variant === "compact") {
    return (
      <div className="flex flex-wrap gap-3 text-xs text-ink-muted">
        {ITEMS.map((i) => (
          <span key={i.key}>
            <span className="font-semibold text-ink">{stats[i.key].toLocaleString()}</span>{" "}
            {t(i.labelKey)}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {ITEMS.map((i) => (
        <div
          key={i.key}
          className="rounded-card border border-border-soft bg-panel p-3 text-center"
        >
          <div className="text-2xl font-semibold text-ink">{stats[i.key].toLocaleString()}</div>
          <div className="text-xs text-ink-muted">{t(i.labelKey)}</div>
        </div>
      ))}
    </div>
  );
}
