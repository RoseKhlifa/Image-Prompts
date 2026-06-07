import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Two-pass masonry layout:
 *
 *   Pass 1 — Greedy shortest-column placement using the item's natural aspect
 *   ratio. Produces a layout that's already much tighter than index-round-robin
 *   (react-masonry-css), but the bottom may still be jagged because the last
 *   few items happen to land on already-short columns.
 *
 *   Pass 2 — Bottom levelling. After pass 1, find the tallest column and the
 *   shortest column. Walk the items in the tallest column from the bottom up
 *   and try moving one to the shortest column if doing so reduces the overall
 *   height variance. Repeat until no swap helps.
 *
 * This gets us close to Pinterest / Wanxiang where the bottom is essentially
 * flush. We avoid distorting images (no force-cropping to a row height) —
 * each card still renders at its natural aspect ratio, we just pick a better
 * column assignment.
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

type Props = {
  items: MasonryItem[];
  /** Breakpoint list, MOST-SPECIFIC FIRST. Last entry should be minWidth:0. */
  breakpoints: MasonryBreakpoint[];
  /** Gap (px) between columns and between cards. */
  gap?: number;
  /** Outer wrapper className. */
  className?: string;
};

type Assignment = { item: MasonryItem; height: number };

function pickColumnCount(width: number, breakpoints: MasonryBreakpoint[]): number {
  for (const b of breakpoints) {
    if (width >= b.minWidth) return b.columns;
  }
  return 1;
}

function totalHeight(col: Assignment[], gap: number): number {
  if (col.length === 0) return 0;
  return col.reduce((sum, a) => sum + a.height, 0) + gap * (col.length - 1);
}

/**
 * Variance of column heights — lower is flatter at the bottom.
 */
function variance(columns: Assignment[][], gap: number): number {
  const heights = columns.map((c) => totalHeight(c, gap));
  const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
  return heights.reduce((sum, h) => sum + (h - mean) ** 2, 0) / heights.length;
}

/**
 * Pass 1: place each item into the currently shortest column.
 */
function greedyPlace(items: MasonryItem[], columnWidth: number, columnCount: number, gap: number): Assignment[][] {
  const columns: Assignment[][] = Array.from({ length: columnCount }, () => []);
  for (const item of items) {
    const ratio = item.aspectRatio && item.aspectRatio > 0 ? item.aspectRatio : 1;
    const height = columnWidth / ratio;
    let shortest = 0;
    for (let i = 1; i < columns.length; i++) {
      if (totalHeight(columns[i]!, gap) < totalHeight(columns[shortest]!, gap)) shortest = i;
    }
    columns[shortest]!.push({ item, height });
  }
  return columns;
}

/**
 * Pass 2: bottom levelling. Try moving the last item of the tallest column to
 * the shortest column, accept the move if it reduces variance. Repeat until
 * no single move helps. Bounded by item count to guarantee termination.
 */
function levelBottoms(columns: Assignment[][], gap: number): Assignment[][] {
  const cols = columns.map((c) => [...c]);
  const maxIterations = cols.reduce((sum, c) => sum + c.length, 0) * 2;

  for (let iter = 0; iter < maxIterations; iter++) {
    const heights = cols.map((c) => totalHeight(c, gap));
    let tallest = 0;
    let shortest = 0;
    for (let i = 1; i < cols.length; i++) {
      if (heights[i]! > heights[tallest]!) tallest = i;
      if (heights[i]! < heights[shortest]!) shortest = i;
    }

    if (tallest === shortest) break;
    const candidate = cols[tallest]!.at(-1);
    if (!candidate) break;

    // Simulate the move
    const before = variance(cols, gap);
    cols[tallest]!.pop();
    cols[shortest]!.push(candidate);
    const after = variance(cols, gap);

    if (after >= before) {
      // Revert — no improvement
      cols[shortest]!.pop();
      cols[tallest]!.push(candidate);
      break;
    }
    // Keep the move, try another iteration
  }

  return cols;
}

export default function Masonry({ items, breakpoints, gap = 4, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (containerWidth <= 0 || items.length === 0) {
      return { columnCount: 0, columnWidth: 0, columns: [] as Assignment[][] };
    }
    const columnCount = pickColumnCount(containerWidth, breakpoints);
    const columnWidth = (containerWidth - gap * (columnCount - 1)) / columnCount;
    const greedy = greedyPlace(items, columnWidth, columnCount, gap);
    const levelled = levelBottoms(greedy, gap);
    return { columnCount, columnWidth, columns: levelled };
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
              {col.map(({ item }) => (
                <div key={item.key}>{item.node}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
