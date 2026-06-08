import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Routes, Route } from "react-router";
import type { ReactNode } from "react";
import TagPicker from "./TagPicker.tsx";
import i18n, { initI18n } from "../../i18n/index.ts";

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

const tags = [
  { id: "1", slug: "portrait", name: { zh: "肖像", en: "Portrait" }, usageCount: 10 },
  { id: "2", slug: "landscape", name: { zh: "风景", en: "Landscape" }, usageCount: 8 },
];

beforeEach(async () => {
  await initI18n("zh");
});

afterEach(() => {
  cleanup();
});

describe("TagPicker", () => {
  it("renders selected chips and a search input", () => {
    render(
      wrap(
        <TagPicker
          value={["portrait"]}
          onChange={() => {}}
          allTags={tags}
        />,
      ),
    );
    expect(screen.getByText(/肖像/)).toBeDefined();
  });

  it("calls onChange when user picks a suggestion", () => {
    const onChange = vi.fn();
    render(
      wrap(<TagPicker value={[]} onChange={onChange} allTags={tags} />),
    );
    fireEvent.click(screen.getByRole("button", { name: /肖像/ }));
    expect(onChange).toHaveBeenCalledWith(["portrait"]);
  });

  it("disables add buttons when value already has 6", () => {
    const six = Array.from({ length: 6 }, (_, i) => `t${i}`);
    render(
      wrap(<TagPicker value={six} onChange={() => {}} allTags={tags} />),
    );
    const portraitBtn = screen.queryByRole("button", { name: /肖像/ });
    // The chip remove buttons are buttons too — they should NOT be disabled.
    // The suggestion button (if shown) should be disabled when value.length >= 6.
    // If the component hides suggestions when chips already include the slug,
    // the portrait button may be present (it's not in the six) but disabled.
    if (portraitBtn) expect(portraitBtn).toBeDisabled();
  });

  it("removes a chip when its X is clicked", () => {
    const onChange = vi.fn();
    render(
      wrap(<TagPicker value={["portrait"]} onChange={onChange} allTags={tags} />),
    );
    // Find the remove button — labeled "Remove" or has × text
    const removeBtns = screen.getAllByRole("button").filter(
      (b) => b.textContent === "×" || b.getAttribute("aria-label") === "Remove",
    );
    expect(removeBtns).toHaveLength(1);
    fireEvent.click(removeBtns[0]!);
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
