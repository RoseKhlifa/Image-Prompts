import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LogIn } from "lucide-react";
import SignInModal from "./SignInModal";

export default function SignInButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-pill border border-accent bg-transparent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft"
      >
        <LogIn size={13} aria-hidden />
        {t("auth.sign_in")}
      </button>
      <SignInModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
