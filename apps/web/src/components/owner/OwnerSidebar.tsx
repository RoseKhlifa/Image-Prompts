import { useTranslation } from "react-i18next";
import { NavLink, useParams } from "react-router";
import {
  LayoutDashboard,
  Settings,
  HardDrive,
  Inbox,
  Megaphone,
  ScrollText,
  Users,
  type LucideIcon,
} from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale";

type Item = { to: string; label: string; icon: LucideIcon; end?: boolean };

export default function OwnerSidebar() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  const items: Item[] = [
    { to: withLocale(locale, "/rosekhlifa"), label: t("owner.nav.dashboard"), icon: LayoutDashboard, end: true },
    { to: withLocale(locale, "/rosekhlifa/config"), label: t("owner.nav.config"), icon: Settings },
    { to: withLocale(locale, "/rosekhlifa/r2"), label: t("owner.nav.r2"), icon: HardDrive },
    { to: withLocale(locale, "/rosekhlifa/users"), label: t("owner.nav.users"), icon: Users },
    { to: withLocale(locale, "/rosekhlifa/audit"), label: t("owner.nav.audit"), icon: ScrollText },
    { to: withLocale(locale, "/rosekhlifa/announcements"), label: t("owner.nav.announcements"), icon: Megaphone },
    { to: withLocale(locale, "/rosekhlifa/submissions"), label: t("owner.nav.submissions"), icon: Inbox },
  ];

  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 self-start border-r border-zinc-800 bg-zinc-950 md:flex md:flex-col">
      <div className="px-4 py-5">
        <div className="px-2 pb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {t("owner.nav.section_admin")}
        </div>
        <nav className="flex flex-col gap-1">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end ?? false}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition",
                    isActive
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
                  ].join(" ")
                }
              >
                <Icon size={16} aria-hidden />
                <span className="truncate">{it.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
