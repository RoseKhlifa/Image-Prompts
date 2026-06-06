import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initI18n } from "./i18n/index";
import { detectLocale } from "./lib/locale";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

await initI18n(detectLocale(window.location.pathname));

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
