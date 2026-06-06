import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { PromptDetail } from "@ip/shared";
import { resolveImageUrl } from "../../lib/imageUrl";
import { useR2PoolMap } from "../../lib/hooks/useR2Pool";

export default function Gallery({
  images,
  title,
}: {
  images: PromptDetail["images"];
  title: string;
}) {
  const [active, setActive] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const { map } = useR2PoolMap();
  const current = images[active] ?? null;
  const mainUrl = resolveImageUrl(current, map);

  // ESC closes lightbox
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxOpen]);

  return (
    <>
      <div className="rounded-md border border-border-soft bg-panel p-2">
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="block w-full overflow-hidden rounded-md bg-surface"
          aria-label={`Open ${title} at full size`}
        >
          <img
            src={mainUrl}
            alt={title}
            loading="eager"
            className="block max-h-[70vh] w-full cursor-zoom-in object-contain"
            width={current?.width ?? undefined}
            height={current?.height ?? undefined}
          />
        </button>
        {images.length > 1 && (
          <div className="mt-2 grid grid-cols-4 gap-2">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                onClick={() => setActive(i)}
                aria-pressed={i === active}
                className={[
                  "overflow-hidden rounded-md border-2 transition-colors",
                  i === active ? "border-accent" : "border-transparent hover:border-border",
                ].join(" ")}
              >
                <img
                  src={resolveImageUrl(img, map)}
                  alt=""
                  className="aspect-square w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxOpen && current && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <img
            src={mainUrl}
            alt={title}
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/30"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
      )}
    </>
  );
}
