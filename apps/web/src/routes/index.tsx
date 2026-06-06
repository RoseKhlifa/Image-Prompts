import { createBrowserRouter, RouterProvider } from "react-router";
import LocaleRedirect from "./locale-redirect";
import LocaleLayout from "./locale-layout";
import RootLayout from "./root-layout";

// Placeholder pages. Real pages land in Tasks 11–14.
function HomePlaceholder() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Home (locale-scoped)</h1>
      <p className="mt-2 text-ink-muted">Replaced by the real Home in Task 11.</p>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <LocaleRedirect /> },
      {
        path: "/:locale",
        element: <LocaleLayout />,
        children: [
          { index: true, element: <HomePlaceholder /> },
          { path: "prompts", element: <HomePlaceholder /> },
          { path: "prompts/:slug", element: <HomePlaceholder /> },
          { path: "categories/:slug", element: <HomePlaceholder /> },
          { path: "about", element: <HomePlaceholder /> },
        ],
      },
      { path: "*", element: <LocaleRedirect /> },
    ],
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
