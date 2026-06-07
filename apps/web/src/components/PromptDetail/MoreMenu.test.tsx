import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n, { initI18n } from "../../i18n";
import MoreMenu from "./MoreMenu";
import { useToastStore } from "../../lib/toast";

function setup() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <MoreMenu promptId="abc" />
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

  it("clicking 'Report' pushes a toast", async () => {
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
