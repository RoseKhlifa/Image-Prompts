import { useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import Avatar from "../components/Avatar";
import StatsCard from "../components/profile/StatsCard";
import PromptCard from "../components/PromptCard";
import Masonry, { type MasonryBreakpoint, type MasonryItem } from "../components/Masonry";
import { CardGridSkeleton } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useUser } from "../lib/hooks/useUser";
import { useUserStats } from "../lib/hooks/useUserStats";
import { useUserPrompts } from "../lib/hooks/useUserPrompts";
import { useUserFavorites } from "../lib/hooks/useUserFavorites";
import { useSession } from "../lib/hooks/useSession";

const BREAKPOINTS: MasonryBreakpoint[] = [
  { minWidth: 1280, columns: 4 },
  { minWidth: 1024, columns: 3 },
  { minWidth: 640, columns: 2 },
  { minWidth: 0, columns: 1 },
];

export default function UserPage() {
  const { t } = useTranslation();
  const { id, locale: param } = useParams<{ id: string; locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const session = useSession();
  const isOwner = !!session.data && session.data.user.id === id;
  const [tab, setTab] = useState<"works" | "favorites">("works");

  const user = useUser(id);
  const stats = useUserStats(id);
  const works = useUserPrompts(id);
  const favorites = useUserFavorites(id, isOwner && tab === "favorites");

  if (user.isLoading) {
    return (
      <AppShell>
        <div className="p-8 text-center text-ink-dim">{t("common.loading")}</div>
      </AppShell>
    );
  }
  if (!user.data) {
    return (
      <AppShell>
        <div className="p-8 text-center text-ink-dim">{t("common.not_found_title")}</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <article className="mx-auto max-w-5xl px-6 py-8">
        {/* Hero */}
        <header className="mb-6 flex items-center gap-4">
          <Avatar
            id={user.data.id}
            name={user.data.name}
            src={user.data.image}
            size={64}
          />
          <div>
            <h1 className="text-xl font-semibold text-ink">
              {user.data.name ?? t("common.anonymous")}
            </h1>
            <p className="text-xs text-ink-muted">
              {t("user.joined_at", {
                date: new Date(user.data.joinedAt).toLocaleDateString(
                  locale === "zh" ? "zh-CN" : "en-US",
                ),
              })}
            </p>
          </div>
        </header>

        {/* Stats */}
        {stats.data && (
          <div className="mb-6">
            <StatsCard stats={stats.data} />
          </div>
        )}

        {/* Tabs */}
        <div role="tablist" className="mb-4 flex gap-4 border-b border-border-soft">
          <button
            role="tab"
            aria-selected={tab === "works"}
            onClick={() => setTab("works")}
            className={`-mb-px border-b-2 px-3 pb-2 text-[13px] font-medium transition ${
              tab === "works"
                ? "border-accent text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t("user.tab_works")}
          </button>
          {isOwner && (
            <button
              role="tab"
              aria-selected={tab === "favorites"}
              onClick={() => setTab("favorites")}
              className={`-mb-px border-b-2 px-3 pb-2 text-[13px] font-medium transition ${
                tab === "favorites"
                  ? "border-accent text-ink"
                  : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {t("user.tab_favorites")}
            </button>
          )}
        </div>

        {/* Tab content */}
        {tab === "works" ? (
          works.isLoading ? (
            <CardGridSkeleton count={6} />
          ) : (works.data?.items.length ?? 0) === 0 ? (
            <EmptyState />
          ) : (
            <Masonry
              items={(works.data?.items ?? []).map<MasonryItem>((p) => ({
                key: p.id,
                aspectRatio:
                  p.primaryImage?.width && p.primaryImage?.height
                    ? p.primaryImage.width / p.primaryImage.height
                    : 1,
                node: <PromptCard prompt={p} />,
              }))}
              breakpoints={BREAKPOINTS}
              gap={4}
              className="p-2"
            />
          )
        ) : favorites.isLoading ? (
          <CardGridSkeleton count={6} />
        ) : (favorites.data?.items.length ?? 0) === 0 ? (
          <EmptyState />
        ) : (
          <Masonry
            items={(favorites.data?.items ?? []).map<MasonryItem>((p) => ({
              key: p.id,
              aspectRatio:
                p.primaryImage?.width && p.primaryImage?.height
                  ? p.primaryImage.width / p.primaryImage.height
                  : 1,
              node: <PromptCard prompt={p} />,
            }))}
            breakpoints={BREAKPOINTS}
            gap={4}
            className="p-2"
          />
        )}
      </article>
    </AppShell>
  );
}
