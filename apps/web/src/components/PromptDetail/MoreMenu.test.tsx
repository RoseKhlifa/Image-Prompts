import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n, { initI18n } from "../../i18n";
import MoreMenu from "./MoreMenu";
import { useToastStore } from "../../lib/toast";

// useSession is the gate that toggles owner-only menu items. The baseline
// tests below want the non-owner shape, so we mock it to return a query
// result that's clearly "anon" (data = null). The mock is hoisted to the
// top of the file by Vitest so it applies before MoreMenu is imported.
vi.mock("../../lib/hooks/useSession", () => ({
  useSession: () => ({ data: null, isLoading: false, isError: false }),
}));

function setup() {
  // A fresh QueryClient per test so the lazy delete mutation hook (loaded by
  // MoreMenu) has a provider to bind to. The mocked useSession means the
  // delete mutation is never invoked here, but the hook still needs context.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={qc}>
          <MoreMenu promptId="abc" slug="abc-slug" titleZh="标题" titleEn="Title" />
        </QueryClientProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await initI18n("en");
  useToastStore.setState({ toasts: [] });
});
afterEach(() => cleanup());

describe("MoreMenu", () => {
  it("opens the menu on trigger click", () => {
    setup();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("clicking 'Report' while signed-out pushes a sign-in toast", async () => {
    // Default `setup` mocks useSession to null, so the menu's report
    // handler hits the early-return branch and toasts instead of opening
    // the modal. When the contributor / owner branches mock a session,
    // the report click opens the ReportModal — that flow has its own
    // dedicated tests.
    setup();
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("menuitem", { name: /report/i }));
    await waitFor(() => {
      expect(useToastStore.getState().toasts.length).toBeGreaterThan(0);
    });
  });

  it("closes on outside click", () => {
    setup();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
