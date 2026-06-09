import { useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Github, Twitter, Globe } from "lucide-react";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
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

  const bio = user.data.bio ? pickBilingual(user.data.bio, locale) : null;
  const socialLinks = user.data.socialLinks ?? null;
  const pinned = user.data.pinnedPrompts ?? [];

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

        {/* Bio + social — only render the surface for set fields. For an
            owner's empty bio we still surface the placeholder; on someone
            else's page we hide the bio block entirely if both sides empty. */}
        {bio ? (
          <p className="mb-4 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
            {bio}
          </p>
        ) : isOwner ? (
          <p className="mb-4 text-[12px] text-ink-dim">{t("profile.bio_empty")}</p>
        ) : (
          <p className="mb-4 text-[12px] text-ink-dim">{t("user.bio_empty")}</p>
        )}

        <SocialRow links={socialLinks} />

        {/* Stats */}
        {stats.data && (
          <div className="mb-6 mt-4">
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
          ) : (
            <>
              {pinned.length > 0 && (
                // Tinted tray so pinned reads as a distinct showcase, not a
                // continuation of the works grid below it.
                <section className="mb-6 rounded-card border border-accent/30 bg-accent-soft/40 p-3">
                  <header className="mb-2 flex items-center justify-between px-1">
                    <h2 className="text-[13px] font-semibold text-ink">
                      {`📌 ${t("user.pinned_section")}`}
                    </h2>
                    <span className="text-[11px] text-ink-dim">
                      {t("user.pinned_count", { n: pinned.length })}
                    </span>
                  </header>
                  <Masonry
                    items={pinned.map<MasonryItem>((p) => ({
                      key: `pinned-${p.id}`,
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
                </section>
              )}
              {(works.data?.items.length ?? 0) === 0 ? (
                <EmptyState />
              ) : (
                <section>
                  {/* Explicit "all works" header so the boundary is clear once
                      pinned is showing. When pinned is empty we still render
                      the header (cheap UX cue + total count). */}
                  <header
                    className={`mb-3 flex items-center justify-between px-1 ${
                      pinned.length > 0 ? "border-t border-border-soft pt-4" : ""
                    }`}
                  >
                    <h2 className="text-[13px] font-semibold text-ink">
                      {`🖼 ${t("user.all_works_section")}`}
                    </h2>
                    <span className="text-[11px] text-ink-dim">
                      {t("user.works_count", { n: works.data?.items.length ?? 0 })}
                    </span>
                  </header>
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
                </section>
              )}
            </>
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

function SocialRow({
  links,
}: {
  links: {
    github?: string;
    twitter?: string;
    bilibili?: string;
    website?: string;
  } | null;
}) {
  if (!links) return null;
  const entries: Array<{ key: string; href: string; node: React.ReactNode }> = [];
  if (links.github)
    entries.push({ key: "github", href: links.github, node: <Github size={16} /> });
  if (links.twitter)
    entries.push({ key: "twitter", href: links.twitter, node: <Twitter size={16} /> });
  if (links.bilibili)
    entries.push({
      key: "bilibili",
      href: links.bilibili,
      node: <span className="px-1 text-[10px] font-bold leading-none">B站</span>,
    });
  if (links.website)
    entries.push({ key: "website", href: links.website, node: <Globe size={16} /> });
  if (entries.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5">
      {entries.map((e) => (
        <li key={e.key}>
          <a
            href={e.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={e.key}
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-pill border border-border-soft bg-surface px-2 text-ink hover:bg-panel-2"
          >
            {e.node}
          </a>
        </li>
      ))}
    </ul>
  );
}
