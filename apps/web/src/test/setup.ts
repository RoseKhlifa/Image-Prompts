import "@testing-library/jest-dom/vitest";

// Node 22+ ships experimental Web Storage that lacks methods like clear();
// vitest's jsdom env then exposes that broken implementation as
// globalThis.localStorage. Force the proper jsdom Storage to win.
if (
  typeof window !== "undefined" &&
  window.localStorage &&
  globalThis.localStorage !== window.localStorage
) {
  Object.defineProperty(globalThis, "localStorage", {
    value: window.localStorage,
    configurable: true,
    writable: true,
  });
}

// jsdom defaults navigator.languages to ["en-US", "en"]. Tests for locale
// detection need a clean slate so they can probe each fallback branch.
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "languages", {
    value: [],
    configurable: true,
  });
}

// jsdom does not implement IntersectionObserver. Components like
// CommunityGuidelinesModal use it to detect scroll-to-bottom, so provide a
// minimal stub that satisfies the IntersectionObserver interface. Tests that
// need to simulate intersection can drive state via fireEvent / setState
// instead — this stub just prevents `new IntersectionObserver(...)` from
// throwing.
class IntersectionObserverStub {
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
  IntersectionObserverStub;
