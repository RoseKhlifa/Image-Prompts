import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { useUiStore } from "../state/uiStore";
import { withLocale } from "../lib/locale";

/**
 * /:locale/submit is a deep-link entry to the modal. On mount it opens the
 * modal and replaces the URL to /:locale (so closing the modal lands the
 * user on the homepage, not stuck on /submit).
 */
export default function SubmitPage() {
  const open = useUiStore((s) => s.openSubmitModal);
  const navigate = useNavigate();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  useEffect(() => {
    open();
    navigate(withLocale(locale, "/"), { replace: true });
  }, [open, navigate, locale]);

  return null;
}
