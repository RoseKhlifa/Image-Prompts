import { useToastStore } from "../lib/toast";

const variantStyles: Record<string, string> = {
  info: "bg-panel-2 text-ink border-border-soft",
  success: "bg-accent text-white border-accent",
  error: "bg-red-600 text-white border-red-700",
};

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto min-w-[240px] max-w-sm rounded-md border px-4 py-2.5 text-[13px] shadow-lg ${
            variantStyles[t.variant] ?? variantStyles.info
          }`}
          onClick={() => dismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
