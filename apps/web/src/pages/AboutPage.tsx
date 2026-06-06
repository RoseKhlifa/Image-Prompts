import { useTranslation } from "react-i18next";
import AppShell from "../components/layout/AppShell";

export default function AboutPage() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <article className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-[28px] font-semibold tracking-tight">{t("about.title")}</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-muted">{t("about.body")}</p>

        <section className="mt-10 rounded-card border border-border-soft bg-panel p-6">
          <h2 className="text-[14px] font-semibold text-ink">{t("about.credits_title")}</h2>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-muted">
            {t("about.credits_body")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
            <a
              href="https://github.com/unknowlei/nanobanana-website"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-pill border border-border-soft bg-surface px-3 py-1.5 text-ink-muted hover:text-ink"
            >
              nanobanana-website ↗
            </a>
            <a
              href="https://github.com/RoseKhlifa/Image-Studio"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-pill border border-border-soft bg-surface px-3 py-1.5 text-ink-muted hover:text-ink"
            >
              Image-Studio ↗
            </a>
            <a
              href="https://github.com/RoseKhlifa/Image-Prompts"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-pill border border-border-soft bg-surface px-3 py-1.5 text-ink-muted hover:text-ink"
            >
              Image-Prompts ↗
            </a>
          </div>
        </section>
      </article>
    </AppShell>
  );
}
