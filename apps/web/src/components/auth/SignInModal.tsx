import { useTranslation } from "react-i18next";
import Modal from "../modals/Modal";

const API_URL = import.meta.env.VITE_API_URL ?? "";

function buildSignInUrl(provider: "google" | "github"): string {
  return `${API_URL}/api/auth/signin/${provider}`;
}

export default function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={t("auth.sign_in")} closeLabel={t("studio_modal.close")}>
      <div className="space-y-2">
        <a
          href={buildSignInUrl("google")}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border-soft bg-surface px-4 py-2.5 text-[13px] font-medium text-ink hover:bg-panel-2"
        >
          {t("auth.sign_in_with", { provider: "Google" })}
        </a>
        <a
          href={buildSignInUrl("github")}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border-soft bg-surface px-4 py-2.5 text-[13px] font-medium text-ink hover:bg-panel-2"
        >
          {t("auth.sign_in_with", { provider: "GitHub" })}
        </a>
      </div>
    </Modal>
  );
}
