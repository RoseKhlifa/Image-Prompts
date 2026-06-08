import { createBrowserRouter, RouterProvider } from "react-router";
import LocaleRedirect from "./locale-redirect";
import LocaleLayout from "./locale-layout";
import HomePage from "../pages/HomePage";
import PromptListPage from "../pages/PromptListPage";
import PromptDetailPage from "../pages/PromptDetailPage";
import AboutPage from "../pages/AboutPage";
import ProfilePage from "../pages/ProfilePage";
import SubmitPage from "../pages/SubmitPage";
import NotFoundPage from "../pages/NotFoundPage";

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
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  { path: "*", element: <LocaleRedirect /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
