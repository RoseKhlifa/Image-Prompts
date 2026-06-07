import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n, { initI18n } from "../../i18n";
import StudioNotInstalledModal, { SUPPRESS_KEY } from "./StudioNotInstalledModal";

function renderModal(open = true, onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <StudioNotInstalledModal
          open={open}
          onClose={onClose}
          prompt={{ en: "test prompt body" }}
        />
      </I18nextProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await initI18n("en");
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("StudioNotInstalledModal", () => {
  it("renders title and body and three actions when open", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/image-studio not detected/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /download image-studio/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy prompt/i })).toBeTruthy();
  });

  it("calls navigator.clipboard.writeText on copy click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /copy prompt/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("test prompt body"));
  });

  it("immediately closes when SUPPRESS_KEY is set in localStorage", () => {
    window.localStorage.setItem(SUPPRESS_KEY, "1");
    const onClose = vi.fn();
    renderModal(true, onClose);
    return new Promise<void>((resolve) => {
      queueMicrotask(() => {
        expect(onClose).toHaveBeenCalled();
        resolve();
      });
    });
  });

  it("checking 'don't ask again' writes SUPPRESS_KEY to localStorage", () => {
    renderModal();
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(window.localStorage.getItem(SUPPRESS_KEY)).toBe("1");
  });
});
