import { describe, it, expect, beforeEach, vi } from "vitest";
import { useUiStore } from "./uiStore";

describe("uiStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    // matchMedia stub: light by default
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("starts as system theme when no localStorage", () => {
    useUiStore.setState({ theme: "system" });
    expect(useUiStore.getState().theme).toBe("system");
  });

  it("setTheme('dark') adds .dark class and persists", () => {
    useUiStore.getState().setTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("ip.theme")).toBe("dark");
    expect(useUiStore.getState().theme).toBe("dark");
  });

  it("setTheme('light') removes .dark class and persists", () => {
    document.documentElement.classList.add("dark");
    useUiStore.getState().setTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("ip.theme")).toBe("light");
  });

  it("setTheme('system') clears localStorage and follows system", () => {
    localStorage.setItem("ip.theme", "dark");
    useUiStore.getState().setTheme("system");
    expect(localStorage.getItem("ip.theme")).toBeNull();
    // system stub returns matches=false, so no .dark
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggleSidebar flips state", () => {
    useUiStore.setState({ sidebarOpen: false });
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });
});
