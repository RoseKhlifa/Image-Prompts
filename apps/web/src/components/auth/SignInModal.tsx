import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../modals/Modal";
import BrandLogo from "../BrandLogo";
import { GoogleIcon, GitHubIcon } from "./OAuthIcons";

const QQ_GROUP_NUMBER = "443136349";
const QQ_GROUP_URL = "https://qm.qq.com/q/hR1qHAHSOA";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/**
 * Auth.js sign-in needs POST + CSRF token (not the Next.js client lib magic).
 * We fetch /api/auth/csrf on modal open, then render a native form per provider
 * that POSTs `csrfToken` + `callbackUrl` form-urlencoded; browser does the
 * navigation, Auth.js handles the redirect to the OAuth provider.
 */
export default function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [csrfToken, setCsrfToken] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`${API_URL}/api/auth/csrf`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { csrfToken: string } | null) => {
        if (!cancelled && d?.csrfToken) setCsrfToken(d.csrfToken);
      })
      .catch(() => {
        /* leave empty → buttons stay disabled */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const callbackUrl = typeof window !== "undefined" ? window.location.href : "/";
  const disabled = !csrfToken;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("auth.sign_in")}
      closeLabel={t("studio_modal.close")}
    >
      <div className="mb-5 flex flex-col items-center gap-3 text-center">
        <BrandLogo size={56} />
        <p className="text-[12.5px] text-ink-muted">{t("auth.sign_in_subtitle")}</p>
      </div>
      <div className="space-y-2">
        <form action={`${API_URL}/api/auth/signin/google`} method="POST">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <button
            type="submit"
            disabled={disabled}
            className="flex w-full items-center justify-center gap-2.5 rounded-md border border-border-soft bg-surface px-4 py-2.5 text-[13px] font-medium text-ink hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GoogleIcon size={18} />
            {t("auth.sign_in_with", { provider: "Google" })}
          </button>
        </form>
        <form action={`${API_URL}/api/auth/signin/github`} method="POST">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <button
            type="submit"
            disabled={disabled}
            className="flex w-full items-center justify-center gap-2.5 rounded-md border border-border-soft bg-surface px-4 py-2.5 text-[13px] font-medium text-ink hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <GitHubIcon size={18} />
            {t("auth.sign_in_with", { provider: "GitHub" })}
          </button>
        </form>
      </div>
      <div className="mt-5 border-t border-border-soft pt-4 text-center text-[11.5px] text-ink-dim">
        {t("auth.qq_group_label")}
        <a
          href={QQ_GROUP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-1 text-accent hover:underline"
        >
          {QQ_GROUP_NUMBER}
        </a>
      </div>
    </Modal>
  );
}
