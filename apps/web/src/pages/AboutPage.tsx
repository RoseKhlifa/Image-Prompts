import AppShell from "../components/layout/AppShell";
import Sidebar from "../components/layout/Sidebar";
import AboutPageContent from "./AboutPageContent";

export default function AboutPage() {
  return (
    <AppShell sidebar={<Sidebar />}>
      <AboutPageContent />
    </AppShell>
  );
}
