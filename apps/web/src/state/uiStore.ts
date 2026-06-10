import { create } from "zustand";
import { type ThemeMode } from "@ip/shared";
import { applyTheme, persistTheme, readPersistedTheme, systemPrefersDark } from "../lib/theme";

type UiState = {
  theme: ThemeMode;
  /** Mobile drawer (MobileMenu) — collapses Sidebar + BrowseTabs + search +
   *  submit CTA into a slide-in drawer below the `md` breakpoint. */
  sidebarOpen: boolean;
  /** Global Submit modal — opened from header CTA and /:locale/submit deep-link. */
  submitModalOpen: boolean;
  setTheme: (mode: ThemeMode) => void;
  toggleSidebar: () => void;
  openSidebar: () => void;
  closeSidebar: () => void;
  openSubmitModal: () => void;
  closeSubmitModal: () => void;
  /** Watch matchMedia and re-apply on system changes when mode is "system". */
  bindSystemThemeWatcher: () => () => void;
};

export const useUiStore = create<UiState>((set, get) => ({
  theme: readPersistedTheme(),
  sidebarOpen: false,
  submitModalOpen: false,

  setTheme: (mode) => {
    applyTheme(mode);
    persistTheme(mode);
    set({ theme: mode });
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),

  openSubmitModal: () => set({ submitModalOpen: true }),
  closeSubmitModal: () => set({ submitModalOpen: false }),

  bindSystemThemeWatcher: () => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (get().theme === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  },
}));

// Expose for debugging
export { systemPrefersDark };
