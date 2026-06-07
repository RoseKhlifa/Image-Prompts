import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n, { initI18n } from "../../i18n";
import CopyPromptButton from "./CopyPromptButton";

function setup() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <CopyPromptButton prompt={{ en: "test prompt body" }} />
      </I18nextProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await initI18n("en");
});
afterEach(() => cleanup());

describe("CopyPromptButton", () => {
  it("copies the prompt to clipboard on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    setup();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("test prompt body"));
  });

  it("does not crash if clipboard API is unavailable", async () => {
    // Use execCommand fallback path
    Object.assign(navigator, { clipboard: undefined });
    document.execCommand = vi.fn().mockReturnValue(true);
    setup();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(document.execCommand).toHaveBeenCalledWith("copy"));
  });
});
