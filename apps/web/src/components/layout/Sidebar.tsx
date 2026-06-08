import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Github } from "lucide-react";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import { useCategories, type CategoryScope } from "../../lib/hooks/useCategories";
import { useTags, type TagScope } from "../../lib/hooks/useTags";
import { useSession } from "../../lib/hooks/useSession";
import { withLocale } from "../../lib/locale";

const REPO_IMAGE_PROMPTS = "https://github.com/RoseKhlifa/Image-Prompts";
const REPO_IMAGE_STUDIO = "https://github.com/RoseKhlifa/Image-Studio";

export default function Sidebar() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [searchParams] = useSearchParams();
  const activeCategory = searchParams.get("category");
  const activeTag = searchParams.get("tag");

  // Counts are derived from whichever tab the visitor is currently browsing
  // on the home page. On `?tab=favorites` we count the user's favorited
  // prompts per category/tag; on `?tab=mine` we count their own submitted
  // prompts. Otherwise (gallery / no tab) we keep the global counts. The
  // scope is only meaningful when authenticated — falls back to global
  // when there's no session so the sidebar stays useful for anon visitors
  // who somehow land on a scoped URL.
  const session = useSession();
  const isAuthed = !!session.data?.user.id;
  const tabParam = searchParams.get("tab");
  const scope: CategoryScope | undefined =
    isAuthed && tabParam === "favorites"
      ? "favorites"
      : isAuthed && tabParam === "mine"
        ? "mine"
        : undefined;

  const categories = useCategories(scope);
  const tags = useTags(scope as TagScope | undefined);

  const totalCount = categories.data?.reduce((n, c) => n + c.promptCount, 0);

  return (
    <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-72 shrink-0 self-start border-r border-border-soft md:flex md:flex-col">
      {/* Scrollable middle: categories + tags */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <SidebarSection label={t("detail.category")}>
          <SidebarLink
            locale={locale}
            pathOverride="/prompts"
            isActive={!activeCategory && !activeTag}
            label={t("common.all")}
            count={totalCount}
          />
          {categories.data?.map((c) => (
            <SidebarLink
              key={c.id}
              locale={locale}
              pathOverride={`/prompts?category=${c.slug}`}
              isActive={activeCategory === c.slug}
              label={pickBilingual(c.name, locale) ?? c.slug}
              count={c.promptCount}
            />
          ))}
        </SidebarSection>

        <SidebarSection label={t("detail.tags")}>
          {tags.data?.slice(0, 20).map((tg) => (
            <SidebarLink
              key={tg.id}
              locale={locale}
              pathOverride={`/prompts?tag=${tg.slug}`}
              isActive={activeTag === tg.slug}
              label={`# ${pickBilingual(tg.name, locale) ?? tg.slug}`}
              count={tg.usageCount}
            />
          ))}
        </SidebarSection>
      </div>

      {/* Footer: open-source attribution */}
      <div className="shrink-0 border-t border-border-soft px-4 py-4">
        <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
          {t("sidebar.repositories")}
        </div>
        <a
          href={REPO_IMAGE_PROMPTS}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-muted hover:bg-surface hover:text-ink"
        >
          <Github size={14} aria-hidden className="shrink-0" />
          <span className="truncate">Image-Prompts</span>
        </a>
        <a
          href={REPO_IMAGE_STUDIO}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-muted hover:bg-surface hover:text-ink"
        >
          <Github size={14} aria-hidden className="shrink-0" />
          <span className="truncate">Image-Studio</span>
        </a>
      </div>
    </aside>
  );
}

function SidebarSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
        {label}
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  );
}

function SidebarLink({
  locale,
  pathOverride,
  isActive,
  label,
  count,
}: {
  locale: Locale;
  pathOverride: string;
  isActive: boolean;
  label: string;
  count?: number | undefined;
}) {
  return (
    <Link
      to={withLocale(locale, pathOverride)}
      className={[
        "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-[15px]",
        isActive ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-surface hover:text-ink",
      ].join(" ")}
    >
      <span className="truncate">{label}</span>
      {count !== undefined && <span className="shrink-0 text-[12px] text-ink-dim">{count}</span>}
    </Link>
  );
}
