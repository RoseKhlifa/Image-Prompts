import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Pinterest-style masonry that places each item into the *currently shortest*
 * column based on its predicted height (computed from aspect ratio). Unlike
 * `react-masonry-css` (which round-robins by index), this minimises gaps when
 * items have very different aspect ratios.
 *
 * Requires `aspectRatio = width / height` per item — when omitted, we assume
 * a square (1.0). For Image-Prompts that means `primaryImage.width/height`
 * from the API; rows missing image dimensions fall back to a sensible default.
 */

export type MasonryItem = {
  /** Stable identity for React reconciliation. */
  key: string;
  /** width / height. If absent, treated as 1.0 (square). */
  aspectRatio?: number;
  /** Rendered content. */
  node: ReactNode;
};

export type MasonryBreakpoint = { minWidth: number; columns: number };

/**
 * Breakpoint list, MOST-SPECIFIC FIRST. The first entry whose minWidth fits
 * the container width wins. Final entry should have minWidth: 0 as the
 * catch-all default.
 */
type Props = {
  items: MasonryItem[];
  breakpoints: MasonryBreakpoint[];
  /** Horizontal + vertical gap (px). */
  gap?: number;
  /** Outer wrapper className (padding etc). */
  className?: string;
};

function pickColumnCount(width: number, breakpoints: MasonryBreakpoint[]): number {
  for (const b of breakpoints) {
    if (width >= b.minWidth) return b.columns;
  }
  // Should be unreachable if breakpoints include a {minWidth:0} entry.
  return 1;
}

export default function Masonry({ items, breakpoints, gap = 4, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track the available width via ResizeObserver so column count + per-column
  // width recompute on viewport resize and sidebar toggles.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (containerWidth <= 0) {
      return { columnCount: 0, columnWidth: 0, columns: [] as Array<{ height: number; items: Array<{ item: MasonryItem; renderHeight: number }> }> };
    }
    const columnCount = pickColumnCount(containerWidth, breakpoints);
    const columnWidth = (containerWidth - gap * (columnCount - 1)) / columnCount;
    const columns: Array<{ height: number; items: Array<{ item: MasonryItem; renderHeight: number }> }> = Array.from(
      { length: columnCount },
      () => ({ height: 0, items: [] }),
    );

    for (const item of items) {
      const ratio = item.aspectRatio && item.aspectRatio > 0 ? item.aspectRatio : 1;
      const renderHeight = columnWidth / ratio;
      // Find shortest column. Ties go to the leftmost for stable ordering.
      let shortestIdx = 0;
      for (let i = 1; i < columns.length; i++) {
        if (columns[i]!.height < columns[shortestIdx]!.height) shortestIdx = i;
      }
      columns[shortestIdx]!.items.push({ item, renderHeight });
      columns[shortestIdx]!.height += renderHeight + gap;
    }

    return { columnCount, columnWidth, columns };
  }, [containerWidth, items, breakpoints, gap]);

  return (
    <div ref={containerRef} className={className}>
      {layout.columnCount > 0 && (
        <div className="flex" style={{ gap: `${gap}px` }}>
          {layout.columns.map((col, ci) => (
            <div
              key={ci}
              className="flex min-w-0 flex-col"
              style={{ width: `${layout.columnWidth}px`, gap: `${gap}px` }}
            >
              {col.items.map(({ item }) => (
                <div key={item.key}>{item.node}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
