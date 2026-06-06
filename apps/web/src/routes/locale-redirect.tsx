import { Navigate, useLocation } from "react-router";
import { detectLocale, stripLocale, withLocale } from "../lib/locale";

/**
 * Mounted at "/" and any path without a locale prefix.
 * Detects preferred locale and redirects.
 */
export default function LocaleRedirect() {
  const location = useLocation();
  const target = detectLocale(location.pathname);
  // Strip any existing locale prefix before re-prepending so the catch-all
  // wildcard ("*") cannot loop into /zh/zh/zh/... on multi-segment unknown
  // paths.
  const stripped = stripLocale(location.pathname);
  const dest = withLocale(target, stripped) + location.search + location.hash;
  return <Navigate to={dest} replace />;
}
