import { createBrowserRouter, RouterProvider } from "react-router";
import LocaleRedirect from "./locale-redirect";
import LocaleLayout from "./locale-layout";
import HomePage from "../pages/HomePage";

function ComingSoon({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
      <p className="mt-2 text-ink-muted">Replaced by the real page in later tasks.</p>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: <LocaleRedirect /> },
  {
    path: "/:locale",
    element: <LocaleLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "prompts", element: <ComingSoon name="List (Task 12)" /> },
      { path: "prompts/:slug", element: <ComingSoon name="Detail (Task 13)" /> },
      { path: "categories/:slug", element: <ComingSoon name="Category (later)" /> },
      { path: "about", element: <ComingSoon name="About (Task 14)" /> },
    ],
  },
  { path: "*", element: <LocaleRedirect /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
