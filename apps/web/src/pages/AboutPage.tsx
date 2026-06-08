import AppShell from "../components/layout/AppShell";
import Sidebar from "../components/layout/Sidebar";
import BrowseTabs from "../components/layout/BrowseTabs";
import AboutPageContent from "./AboutPageContent";

export default function AboutPage() {
  return (
    <AppShell sidebar={<Sidebar />}>
      <BrowseTabs />
      <AboutPageContent />
    </AppShell>
  );
}
