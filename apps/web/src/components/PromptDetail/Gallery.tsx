import { useState } from "react";
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
  const { map } = useR2PoolMap();
  const current = images[active] ?? null;
  const mainUrl = resolveImageUrl(current, map);

  return (
    <div className="rounded-card border border-border-soft bg-panel p-2">
      <div className="overflow-hidden rounded-[14px] bg-surface">
        <img
          src={mainUrl}
          alt={title}
          className="block max-h-[70vh] w-full object-contain"
          width={current?.width ?? undefined}
          height={current?.height ?? undefined}
        />
      </div>
      {images.length > 1 && (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              aria-pressed={i === active}
              className={[
                "overflow-hidden rounded-[10px] border-2 transition-colors",
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
  );
}
