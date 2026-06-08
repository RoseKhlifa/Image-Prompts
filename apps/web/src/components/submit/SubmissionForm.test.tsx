import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Routes, Route } from "react-router";
import type { ReactNode } from "react";
import i18n, { initI18n } from "../../i18n";
import SubmissionForm from "./SubmissionForm";

vi.mock("../../lib/hooks/useCategories", () => ({
  useCategories: () => ({
    data: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        slug: "cat-1",
        name: { zh: "分类一", en: "Category 1" },
      },
    ],
  }),
}));

vi.mock("../../lib/hooks/useCreateSubmission", () => ({
  useCreateSubmission: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

beforeEach(async () => {
  await initI18n("zh");
});

afterEach(() => {
  cleanup();
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={["/zh/submit"]}>
          <Routes>
            <Route path="/:locale/submit" element={ui} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>
  );
}

describe("SubmissionForm", () => {
  it("shows field-level errors on empty submit", async () => {
    render(wrap(<SubmissionForm />));
    fireEvent.click(screen.getByRole("button", { name: /提交|Submit/ }));
    await waitFor(() => {
      const reds = document.querySelectorAll(".text-red-600");
      expect(reds.length).toBeGreaterThan(0);
    });
  });
});
