import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, type Locale } from "@ip/shared";
import { Github, Mail, ArrowRight, ExternalLink, Pin } from "lucide-react";
import { useStats } from "../lib/hooks/useStats";
import { withLocale } from "../lib/locale";

/**
 * /:locale/about — single long-scroll about page with a sticky right-rail
 * TOC on lg+ and section anchors. Source attribution, tech stack,
 * acknowledgments, timeline, maintainer note, contact info — everything
 * a visitor needs to understand who built this and where the content
 * came from. The full policy lives at /about/policy.
 */
export default function AboutPageContent() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const stats = useStats();

  const sections = [
    { id: "intro", label: t("about.section_intro_title") },
    { id: "sources", label: t("about.section_sources_title") },
    { id: "submit", label: t("about.section_submit_title") },
    { id: "tech", label: t("about.section_tech_title") },
    { id: "maintainer", label: t("about.section_maintainer_title") },
    { id: "acknowledgments", label: t("about.section_acknowledgments_title") },
    { id: "timeline", label: t("about.section_timeline_title") },
    { id: "contact", label: t("about.section_contact_title") },
  ];

  return (
    <article className="mx-auto max-w-6xl px-6 py-14">
      {/* Hero */}
      <header className="border-b border-border-soft pb-10">
        <div className="flex items-center gap-4">
          <img
            src="/logo.png"
            alt="Image-Prompts logo"
            width={64}
            height={64}
            className="h-16 w-16 shrink-0 rounded-card border border-border-soft bg-panel object-cover shadow-sm"
          />
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-dim">
            / Image-Prompts
          </p>
        </div>
        <h1 className="mt-5 font-serif text-[40px] font-semibold leading-tight tracking-tight text-ink sm:text-[48px]">
          {t("about.title")}
        </h1>
        <p className="mt-4 max-w-2xl font-serif text-[17px] italic leading-snug text-ink-muted">
          {t("about.tagline")}
        </p>
        <p className="mt-6 max-w-3xl text-[15px] leading-relaxed text-ink-muted">
          {t("about.hero_body")}
        </p>
      </header>

      {/* Live stats */}
      <StatsRow
        stats={stats.data}
        title={t("about.stats_title")}
        subtitle={t("about.stats_subtitle")}
        labels={{
          prompts: t("about.stat_prompts"),
          contributors: t("about.stat_contributors"),
          categories: t("about.stat_categories"),
          tags: t("about.stat_tags"),
        }}
      />

      {/* Body grid */}
      <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_220px]">
        <main className="min-w-0 space-y-20">
          <Section
            num="01"
            id="intro"
            title={t("about.section_intro_title")}
            paragraphs={[
              t("about.section_intro_p0"),
              t("about.section_intro_p1"),
              t("about.section_intro_p2"),
            ]}
          />

          <Section
            num="02"
            id="sources"
            title={t("about.section_sources_title")}
            paragraphs={[t("about.section_sources_intro")]}
          >
            <SourcesTable t={t} />
          </Section>

          <Section
            num="03"
            id="submit"
            title={t("about.section_submit_title")}
            paragraphs={[
              t("about.section_submit_p1"),
              t("about.section_submit_p2"),
            ]}
          >
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to={withLocale(locale, "/submit")}
                className="inline-flex items-center gap-1.5 rounded-pill bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-2"
              >
                {t("about.section_submit_cta_submit")}
                <ArrowRight size={14} />
              </Link>
              <a
                href="https://github.com/RoseKhlifa/Image-Prompts/blob/main/docs/community-guidelines.md"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-pill border border-border-soft bg-surface px-4 py-2 text-sm text-ink-muted hover:text-ink"
              >
                {t("about.section_submit_cta_guidelines")}
                <ExternalLink size={12} />
              </a>
            </div>
          </Section>

          <Section
            num="04"
            id="tech"
            title={t("about.section_tech_title")}
            paragraphs={[t("about.section_tech_p1")]}
          >
            <h3 className="mt-6 font-serif text-[15px] font-semibold text-ink">
              {t("about.section_tech_repos_title")}
            </h3>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <RepoCard
                href="https://github.com/RoseKhlifa/Image-Prompts"
                title={t("about.repo_image_prompts_title")}
                desc={t("about.repo_image_prompts_desc")}
              />
              <RepoCard
                href="https://github.com/RoseKhlifa/Image-Studio"
                title={t("about.repo_image_studio_title")}
                desc={t("about.repo_image_studio_desc")}
              />
            </div>
          </Section>

          <Section
            num="05"
            id="maintainer"
            title={t("about.section_maintainer_title")}
            paragraphs={[
              t("about.section_maintainer_p1"),
              t("about.section_maintainer_p2"),
            ]}
          >
            <p className="mt-4 font-serif text-[14px] italic text-ink-dim">
              {t("about.section_maintainer_signature")}
            </p>
          </Section>

          <Section
            num="06"
            id="acknowledgments"
            title={t("about.section_acknowledgments_title")}
            paragraphs={[t("about.section_acknowledgments_intro")]}
          >
            <AcknowledgmentsGrid t={t} />
          </Section>

          <Section
            num="07"
            id="timeline"
            title={t("about.section_timeline_title")}
            paragraphs={[t("about.section_timeline_intro")]}
          >
            <Timeline t={t} />
          </Section>

          <Section
            num="08"
            id="contact"
            title={t("about.section_contact_title")}
            paragraphs={[t("about.section_contact_p1")]}
          >
            <ContactBlock t={t} />
            <div className="mt-6 border-t border-border-soft pt-6">
              <Link
                to={withLocale(locale, "/about/policy")}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
              >
                {t("about.policy_link")}
                <ArrowRight size={14} />
              </Link>
            </div>
          </Section>
        </main>

        <TocRail sections={sections} title={t("about.toc_title")} />
      </div>
    </article>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function StatsRow({
  stats,
  title,
  subtitle,
  labels,
}: {
  stats: { publishedCount: number; contributorCount: number; categoryCount: number; tagCount: number } | undefined;
  title: string;
  subtitle: string;
  labels: { prompts: string; contributors: string; categories: string; tags: string };
}) {
  const cells = [
    { label: labels.prompts, value: stats?.publishedCount },
    { label: labels.contributors, value: stats?.contributorCount },
    { label: labels.categories, value: stats?.categoryCount },
    { label: labels.tags, value: stats?.tagCount },
  ];
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-dim">
          {title}
        </h2>
        <p className="hidden text-[12px] text-ink-dim sm:block">{subtitle}</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map((c, i) => (
          <div
            key={i}
            className="rounded-card border border-border-soft bg-panel px-4 py-5"
          >
            <div className="font-serif text-[34px] font-semibold leading-none text-ink">
              {c.value !== undefined ? c.value.toLocaleString() : "—"}
            </div>
            <div className="mt-2 text-[12px] text-ink-muted">{c.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-ink-dim sm:hidden">{subtitle}</p>
    </section>
  );
}

function Section({
  num,
  id,
  title,
  paragraphs,
  children,
}: {
  num: string;
  id: string;
  title: string;
  paragraphs: string[];
  children?: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-6 flex items-baseline gap-4">
        <span className="font-mono text-[12px] tracking-widest text-ink-dim">
          {num}
        </span>
        <h2 className="font-serif text-[26px] font-semibold tracking-tight text-ink">
          {title}
        </h2>
      </div>
      <div className="space-y-4">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-[15px] leading-relaxed text-ink-muted">
            {p}
          </p>
        ))}
      </div>
      {children}
    </section>
  );
}

const DATA_SOURCES: Array<{
  name: string;
  url: string;
  count: number;
}> = [
  // Sorted by upstream count desc.
  {
    name: "Liblib Inspiration",
    url: "https://www.liblib.art/inspiration",
    count: 21826,
  },
  {
    name: "YouMind GPT Image 2 Prompts",
    url: "https://youmind.com/zh-CN/gpt-image-2-prompts",
    count: 9303,
  },
  {
    name: "AI2Image GPT Image 2",
    url: "https://www.ai2image.cn/category?cat=gptimage2",
    count: 1913,
  },
  {
    name: "Nanobanana Website Vercel",
    url: "https://nanobanana-website.vercel.app/",
    count: 1205,
  },
  {
    name: "NanoBananaPrompt",
    url: "https://nanobananaprompt.co/zh/prompts",
    count: 192,
  },
];

function SourcesTable({ t }: { t: (k: string) => string }) {
  return (
    <div className="mt-6 overflow-x-auto rounded-card border border-border-soft bg-panel">
      <table className="w-full text-[13px]">
        <thead className="border-b border-border-soft text-[11px] uppercase tracking-wider text-ink-dim">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">
              {t("about.sources_col_source")}
            </th>
            <th className="px-4 py-3 text-left font-semibold">
              {t("about.sources_col_url")}
            </th>
            <th className="px-4 py-3 text-right font-semibold">
              {t("about.sources_col_count")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-soft">
          {DATA_SOURCES.map((s) => (
            <tr key={s.url} className="hover:bg-bg-2">
              <td className="px-4 py-3 font-medium text-ink">{s.name}</td>
              <td className="px-4 py-3">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 truncate text-ink-muted hover:text-accent"
                >
                  <span className="truncate font-mono text-[12px]">
                    {s.url.replace(/^https?:\/\//, "")}
                  </span>
                  <ExternalLink size={11} className="shrink-0" />
                </a>
              </td>
              <td className="px-4 py-3 text-right font-mono text-[13px] text-ink">
                {s.count.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RepoCard({
  href,
  title,
  desc,
}: {
  href: string;
  title: string;
  desc: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="group flex flex-col rounded-card border border-border-soft bg-panel p-4 transition-colors hover:border-accent/40"
    >
      <div className="flex items-center gap-2 text-[14px] font-semibold text-ink">
        <Github size={14} className="text-ink-dim" />
        <span>{title}</span>
        <ExternalLink
          size={11}
          className="ml-auto text-ink-dim transition-colors group-hover:text-accent"
        />
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
        {desc}
      </p>
    </a>
  );
}

const ACK_GROUPS: Array<{
  key: "runtime" | "data" | "ui" | "infra" | "data_sources";
  items: string[];
}> = [
  {
    key: "runtime",
    items: [
      "React 18",
      "Vite",
      "TypeScript",
      "Hono",
      "Vitest",
    ],
  },
  {
    key: "data",
    items: ["PostgreSQL", "Drizzle ORM", "Cloudflare R2", "Better Auth"],
  },
  {
    key: "ui",
    items: [
      "Tailwind CSS",
      "lucide-react",
      "TanStack Query",
      "i18next",
      "Inter / Noto Sans SC",
    ],
  },
  {
    key: "infra",
    items: ["Cloudflare", "GitHub Actions", "Google / GitHub OAuth"],
  },
];

function AcknowledgmentsGrid({ t }: { t: (k: string) => string }) {
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2">
      {ACK_GROUPS.map((g) => (
        <div
          key={g.key}
          className="rounded-card border border-border-soft bg-panel p-4"
        >
          <h4 className="font-mono text-[11px] uppercase tracking-wider text-ink-dim">
            {t(`about.ack_group_${g.key}`)}
          </h4>
          <ul className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
            {g.items.map((item) => (
              <li
                key={item}
                className="rounded-pill border border-border-soft bg-surface px-2.5 py-0.5 text-ink-muted"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const TIMELINE: Array<{ date: string; key: string }> = [
  { date: "2026-06-06", key: "spec" },
  { date: "2026-06-07", key: "auth" },
  { date: "2026-06-08", key: "polish" },
  { date: "2026-06-08", key: "deploy" },
  { date: "2026-06-09", key: "import" },
  { date: "2026-06-09", key: "nsfw" },
  { date: "2026-06-09", key: "launch" },
];

function Timeline({ t }: { t: (k: string) => string }) {
  return (
    <ol className="mt-6 space-y-3 border-l-2 border-border-soft pl-6">
      {TIMELINE.map((e, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[27px] top-1 h-2 w-2 rounded-full bg-accent" />
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-mono text-[11px] tracking-wider text-ink-dim">
              {e.date}
            </span>
            <span className="text-[13.5px] text-ink-muted">
              {t(`about.timeline_event_${e.key}`)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ContactBlock({ t }: { t: (k: string) => string }) {
  const email = t("about.contact_email_value");
  const gh = t("about.contact_github_value");
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <a
        href={`mailto:${email}`}
        className="group flex items-center gap-3 rounded-card border border-border-soft bg-panel p-4 hover:border-accent/40"
      >
        <Mail size={18} className="shrink-0 text-ink-dim" />
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-wider text-ink-dim">
            {t("about.contact_email_label")}
          </div>
          <div className="mt-0.5 truncate text-[14px] font-medium text-ink">
            {email}
          </div>
        </div>
      </a>
      <a
        href="https://github.com/RoseKhlifa/Image-Prompts/issues"
        target="_blank"
        rel="noreferrer noopener"
        className="group flex items-center gap-3 rounded-card border border-border-soft bg-panel p-4 hover:border-accent/40"
      >
        <Github size={18} className="shrink-0 text-ink-dim" />
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-wider text-ink-dim">
            {t("about.contact_github_label")}
          </div>
          <div className="mt-0.5 truncate text-[14px] font-medium text-ink">
            {gh}
          </div>
        </div>
      </a>
      <p className="text-[12px] leading-relaxed text-ink-dim sm:col-span-2">
        {t("about.contact_takedown_hint")}
      </p>
    </div>
  );
}

function TocRail({
  sections,
  title,
}: {
  sections: Array<{ id: string; label: string }>;
  title: string;
}) {
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);

  useEffect(() => {
    const elements = sections
      .map((s) => document.getElementById(s.id))
      .filter((e): e is HTMLElement => e !== null);
    if (elements.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the top that's currently intersecting.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) =>
              a.boundingClientRect.top - b.boundingClientRect.top,
          );
        if (visible[0]) setActive(visible[0].target.id);
      },
      {
        // Activate when the section's top crosses ~30% from viewport top.
        rootMargin: "-30% 0px -55% 0px",
        threshold: 0,
      },
    );
    for (const el of elements) io.observe(el);
    return () => io.disconnect();
  }, [sections]);

  return (
    <aside className="hidden lg:block">
      <nav className="sticky top-24">
        <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-dim">
          <Pin size={11} aria-hidden />
          {title}
        </div>
        <ul className="space-y-1.5">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={`block rounded px-2 py-1 text-[12.5px] transition-colors ${
                  active === s.id
                    ? "bg-accent-soft text-accent"
                    : "text-ink-muted hover:bg-surface hover:text-ink"
                }`}
              >
                <span className="mr-2 font-mono text-[10px] text-ink-dim">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
