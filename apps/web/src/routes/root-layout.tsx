import { Outlet } from "react-router";
import { useTranslation } from "react-i18next";
import LangSwitcher from "../components/LangSwitcher";

/**
 * Root layout — sits inside RouterProvider so the Header and LangSwitcher
 * can use useNavigate / useLocation / useParams hooks.
 */
function Header() {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border-soft bg-panel-2/85 px-5 py-3 backdrop-blur">
      <div className="text-base font-semibold tracking-tight">Image-Prompts</div>
      <nav className="hidden gap-1 text-sm md:flex">
        <a className="rounded-pill px-3 py-1.5 text-ink-muted hover:text-ink" href="/zh">
          {t("nav.browse")}
        </a>
        <a className="rounded-pill px-3 py-1.5 text-ink-muted hover:text-ink" href="/zh/about">
          {t("nav.about")}
        </a>
      </nav>
      <div className="flex items-center gap-2">
        <LangSwitcher />
      </div>
    </header>
  );
}

export default function RootLayout() {
  return (
    <>
      <Header />
      <Outlet />
    </>
  );
}
