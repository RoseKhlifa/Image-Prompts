import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import AvatarBadge from "../auth/AvatarBadge";
import { useInvalidateSession, type Session } from "../../lib/hooks/useSession";
import { signOut } from "../../lib/auth";
import { toast } from "../../lib/toast";
import { withLocale } from "../../lib/locale";

export default function ProfileInfoTab({ session }: { session: Session }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const invalidate = useInvalidateSession();

  async function handleSignOut() {
    await signOut();
    await invalidate();
    toast.info(t("auth.sign_out"));
    navigate(withLocale(locale, "/"), { replace: true });
  }

  const u = session.user;
  return (
    <div className="mx-auto max-w-md">
      <div className="flex flex-col items-center gap-4 rounded-card border border-border-soft bg-panel p-8">
        <AvatarBadge src={u.image} name={u.name} email={u.email} size={72} />
        {u.name && <div className="text-base font-medium">{u.name}</div>}
        <div className="text-[13px] text-ink-muted">{u.email}</div>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-4 rounded-pill border border-border-soft bg-surface px-5 py-2 text-[13px] font-medium text-ink hover:bg-panel-2"
        >
          {t("profile.sign_out_button")}
        </button>
      </div>
    </div>
  );
}
