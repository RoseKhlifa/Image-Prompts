import { createBrowserRouter, RouterProvider } from "react-router";
import LocaleRedirect from "./locale-redirect";
import LocaleLayout from "./locale-layout";
import OwnerGuard from "./owner-guard";
import HomePage from "../pages/HomePage";
import PromptListPage from "../pages/PromptListPage";
import PromptDetailPage from "../pages/PromptDetailPage";
import AboutPage from "../pages/AboutPage";
import ProfilePage from "../pages/ProfilePage";
import SubmitPage from "../pages/SubmitPage";
import UserPage from "../pages/UserPage";
import AdminSubmissionsPage from "../pages/AdminSubmissionsPage";
import NotFoundPage from "../pages/NotFoundPage";
import OwnerLayout from "../pages/owner/OwnerLayout";
import DashboardPage from "../pages/owner/DashboardPage";
import ConfigPage from "../pages/owner/ConfigPage";
import R2Page from "../pages/owner/R2Page";
import OwnerSubmissionsPage from "../pages/owner/SubmissionsPage";
import UsersPage from "../pages/owner/UsersPage";
import AuditPage from "../pages/owner/AuditPage";
import AnnouncementsPage from "../pages/owner/AnnouncementsPage";
import CategoriesPage from "../pages/owner/CategoriesPage";
import TagsPage from "../pages/owner/TagsPage";

export const router = createBrowserRouter([
  { path: "/", element: <LocaleRedirect /> },
  {
    path: "/:locale",
    element: <LocaleLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "prompts", element: <PromptListPage /> },
      { path: "prompts/:slug", element: <PromptDetailPage /> },
      { path: "categories/:slug", element: <PromptListPage /> },
      { path: "about", element: <AboutPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "submit", element: <SubmitPage /> },
      { path: "users/:id", element: <UserPage /> },
      { path: "admin/submissions", element: <AdminSubmissionsPage /> },
      { path: "admin/submissions/:id", element: <AdminSubmissionsPage /> },
      {
        path: "rosekhlifa",
        element: <OwnerGuard />,
        children: [
          {
            element: <OwnerLayout />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: "config", element: <ConfigPage /> },
              { path: "r2", element: <R2Page /> },
              { path: "submissions", element: <OwnerSubmissionsPage /> },
              { path: "submissions/:id", element: <OwnerSubmissionsPage /> },
              { path: "users", element: <UsersPage /> },
              { path: "audit", element: <AuditPage /> },
              { path: "announcements", element: <AnnouncementsPage /> },
              { path: "categories", element: <CategoriesPage /> },
              { path: "tags", element: <TagsPage /> },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  { path: "*", element: <LocaleRedirect /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
