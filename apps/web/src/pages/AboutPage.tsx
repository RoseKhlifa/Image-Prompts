import AppShell from "../components/layout/AppShell";
import AboutPageContent from "./AboutPageContent";

export default function AboutPage() {
  // No sidebar on About — the page is read-only copy, not a browse surface,
  // so category/tag navigation would be visual clutter.
  return (
    <AppShell>
      <AboutPageContent />
    </AppShell>
  );
}
