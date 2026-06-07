import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Toaster from "./components/Toaster";
import { initI18n } from "./i18n/index";
import { detectLocale } from "./lib/locale";
import { applyTheme, readPersistedTheme } from "./lib/theme";
import { useUiStore } from "./state/uiStore";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

// Apply persisted theme synchronously before any React render to avoid flash.
applyTheme(readPersistedTheme());

// Bind system theme watcher; ignore the unsubscribe (lives for app lifetime).
useUiStore.getState().bindSystemThemeWatcher();

await initI18n(detectLocale(window.location.pathname));

createRoot(rootEl).render(
  <StrictMode>
    <App />
    <Toaster />
  </StrictMode>,
);
