import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, type Locale } from "@ip/shared";
import { ArrowLeft, Pin } from "lucide-react";
import AppShell from "../components/layout/AppShell";
import { withLocale } from "../lib/locale";

/**
 * /:locale/about/policy — split out of the About page because the policy
 * material is the most likely to be checked against (legal review,
 * takedown disputes, etc.) and deserves a stable URL of its own. Same
 * long-scroll + sticky TOC pattern as the About page, but without stats
 * or repo cards.
 */
export default function PolicyPage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  const sections = [
    { id: "nsfw", label: t("policy.section_nsfw_title") },
    { id: "copyright", label: t("policy.section_copyright_title") },
    { id: "submission", label: t("policy.section_submission_title") },
    { id: "forbidden", label: t("policy.section_forbidden_title") },
    { id: "tos", label: t("policy.section_tos_title") },
  ];

  return (
    <AppShell>
      <article className="mx-auto max-w-6xl px-6 py-14">
        <header className="border-b border-border-soft pb-10">
          <Link
            to={withLocale(locale, "/about")}
            className="inline-flex items-center gap-1 text-[12.5px] text-ink-muted hover:text-ink"
          >
            <ArrowLeft size={12} />
            {t("policy.back_to_about")}
          </Link>
          <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-dim">
            / Policy &amp; Terms
          </p>
          <h1 className="mt-3 font-serif text-[40px] font-semibold leading-tight tracking-tight text-ink sm:text-[48px]">
            {t("policy.title")}
          </h1>
          <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-ink-muted">
            {t("policy.intro")}
          </p>
        </header>

        <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_220px]">
          <main className="min-w-0 space-y-20">
            <PolicySection
              num="01"
              id="nsfw"
              title={t("policy.section_nsfw_title")}
              paragraphs={[
                t("policy.section_nsfw_p1"),
                t("policy.section_nsfw_p2"),
                t("policy.section_nsfw_p3"),
              ]}
            />

            <PolicySection
              num="02"
              id="copyright"
              title={t("policy.section_copyright_title")}
              paragraphs={[
                t("policy.section_copyright_p1"),
                t("policy.section_copyright_p2"),
              ]}
            >
              <div className="mt-6 rounded-card border border-border-soft bg-panel p-5">
                <h3 className="font-mono text-[11px] uppercase tracking-wider text-ink-dim">
                  {t("policy.copyright_template_title")}
                </h3>
                <pre className="mt-3 whitespace-pre-wrap font-mono text-[12.5px] leading-[1.7] text-ink">
                  {t("policy.copyright_template_body")}
                </pre>
              </div>
              <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">
                {t("policy.section_copyright_p3")}
              </p>
            </PolicySection>

            <PolicySection
              num="03"
              id="submission"
              title={t("policy.section_submission_title")}
              paragraphs={[t("policy.section_submission_intro")]}
            >
              <ol className="mt-4 list-decimal space-y-2 pl-6 text-[14.5px] leading-relaxed text-ink-muted">
                <li>{t("policy.section_submission_l1")}</li>
                <li>{t("policy.section_submission_l2")}</li>
                <li>{t("policy.section_submission_l3")}</li>
                <li>{t("policy.section_submission_l4")}</li>
              </ol>
            </PolicySection>

            <PolicySection
              num="04"
              id="forbidden"
              title={t("policy.section_forbidden_title")}
              paragraphs={[t("policy.section_forbidden_intro")]}
            >
              <ul className="mt-4 list-disc space-y-2 pl-6 text-[14.5px] leading-relaxed text-ink-muted">
                <li>{t("policy.forbidden_l1")}</li>
                <li>{t("policy.forbidden_l2")}</li>
                <li>{t("policy.forbidden_l3")}</li>
                <li>{t("policy.forbidden_l4")}</li>
                <li>{t("policy.forbidden_l5")}</li>
                <li>{t("policy.forbidden_l6")}</li>
              </ul>
            </PolicySection>

            <PolicySection
              num="05"
              id="tos"
              title={t("policy.section_tos_title")}
              paragraphs={[
                t("policy.section_tos_p1"),
                t("policy.section_tos_p2"),
                t("policy.section_tos_p3"),
                t("policy.section_tos_p4"),
              ]}
            />
          </main>

          <PolicyTocRail
            sections={sections}
            title={t("policy.toc_title")}
          />
        </div>
      </article>
    </AppShell>
  );
}

function PolicySection({
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

function PolicyTocRail({
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
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: 0 },
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
