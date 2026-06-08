import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale";
import { useInvalidateSession, type Session } from "../../lib/hooks/useSession";
import { signOut } from "../../lib/auth";
import { toast } from "../../lib/toast";
import AvatarBadge from "./AvatarBadge";

export default function ProfileMenu({ session }: { session: Session }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const invalidate = useInvalidateSession();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }
    return undefined;
  }, [open]);

  async function handleSignOut() {
    await signOut();
    await invalidate();
    toast.info(t("auth.sign_out"));
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-pill p-0.5 hover:bg-panel-2"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <AvatarBadge
          src={session.user.image}
          name={session.user.name}
          email={session.user.email}
          size={28}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-60 rounded-card border border-border-soft bg-panel p-2 shadow-lg"
        >
          <div className="flex items-center gap-2 px-2 py-2">
            <AvatarBadge
              src={session.user.image}
              name={session.user.name}
              email={session.user.email}
              size={32}
            />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-ink">
                {session.user.name ?? session.user.email.split("@")[0]}
              </div>
              <div className="truncate text-[11px] text-ink-dim">{session.user.email}</div>
            </div>
          </div>
          <div className="my-1 h-px bg-border-soft" />
          <Link
            to={withLocale(locale, "/profile")}
            onClick={() => setOpen(false)}
            className="block rounded-md px-2 py-1.5 text-[12.5px] text-ink hover:bg-panel-2"
            role="menuitem"
          >
            {t("auth.profile")}
          </Link>
          {(session.user.role === "admin" || session.user.role === "moderator") && (
            <Link
              // Owners jump straight into the unified /rosekhlifa dashboard
              // (dark-themed submission queue + the rest of the console).
              // Non-owner admins/moderators keep using the legacy
              // /admin/submissions surface (OwnerGuard would 403 them).
              to={withLocale(
                locale,
                (session.user as { isOwner?: boolean }).isOwner
                  ? "/rosekhlifa/submissions"
                  : "/admin/submissions",
              )}
              onClick={() => setOpen(false)}
              className="block rounded-md px-2 py-1.5 text-[12.5px] text-ink hover:bg-panel-2"
              role="menuitem"
            >
              {t("nav.admin")}
            </Link>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="block w-full rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-panel-2"
            role="menuitem"
          >
            {t("auth.sign_out")}
          </button>
        </div>
      )}
    </div>
  );
}
