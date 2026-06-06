export default function App() {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Image-Prompts</h1>
        <p className="mt-2 text-text-muted">
          Skeleton boots. Tokens working. Routing/i18n/UI will land in Tasks 7–14.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-2 transition-colors"
            onClick={() => document.documentElement.classList.toggle("dark")}
          >
            Toggle dark
          </button>
          <a
            href="/api/prompts"
            className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text-muted hover:text-text transition-colors"
          >
            Test /api/prompts
          </a>
        </div>
      </div>
    </div>
  );
}
