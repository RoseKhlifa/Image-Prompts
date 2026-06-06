import { Outlet } from "react-router";

/**
 * Root layout — sits inside RouterProvider so child routes can use
 * useNavigate / useLocation / useParams hooks. The page chrome (Header,
 * theme/lang switchers) lives in AppShell now, which individual pages
 * compose themselves starting in Task 11.
 */
export default function RootLayout() {
  return <Outlet />;
}
