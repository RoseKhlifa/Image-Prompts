import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Multi-pass masonry that targets a flush bottom even with mixed aspect ratios.
 *
 *   Pass 1 — Sort items by predicted height (tallest first). This is the key
 *   to a flush bottom: when a wildly tall outlier (e.g. portrait at 0.4 ratio)
 *   gets placed FIRST, the greedy step that follows can balance around it
 *   instead of getting blindsided by it three-quarters of the way through.
 *
 *   Pass 2 — Greedy shortest-column placement. Each item goes into whichever
 *   column is currently shortest. After pass 1's pre-sort, this leaves the
 *   layout already quite even.
 *
 *   Pass 3 — Local search: for every pair of columns (i, j), try moving each
 *   of column i's items to column j. Accept the first move that strictly
 *   reduces total height variance. Restart the scan from the top after any
 *   accepted move. Bounded by item count × pass count to guarantee
 *   termination. Faster in practice because most moves don't help and the
 *   scan exits quickly once near-optimal.
 *
 *   Pass 4 — Restore visual order. Pass 1's sort destroyed the original
 *   item order; after layout we re-order each column's contents so that
 *   earlier-API-order items appear higher in the column. This is purely
 *   cosmetic — column heights are unaffected by reordering within a column.
 *
 * Image aspect ratios are NEVER distorted. We only change which column an
 * item belongs to; rendered size stays natural.
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

type Slot = { item: MasonryItem; height: number; order: number };

function pickColumnCount(width: number, breakpoints: MasonryBreakpoint[]): number {
  for (const b of breakpoints) {
    if (width >= b.minWidth) return b.columns;
  }
  return 1;
}

function colHeight(col: Slot[], gap: number): number {
  if (col.length === 0) return 0;
  return col.reduce((sum, s) => sum + s.height, 0) + gap * (col.length - 1);
}

function variance(columns: Slot[][], gap: number): number {
  const heights = columns.map((c) => colHeight(c, gap));
  const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
  return heights.reduce((sum, h) => sum + (h - mean) ** 2, 0) / heights.length;
}

function greedyPlace(slots: Slot[], columnCount: number, gap: number): Slot[][] {
  const columns: Slot[][] = Array.from({ length: columnCount }, () => []);
  for (const slot of slots) {
    let shortest = 0;
    for (let i = 1; i < columns.length; i++) {
      if (colHeight(columns[i]!, gap) < colHeight(columns[shortest]!, gap)) shortest = i;
    }
    columns[shortest]!.push(slot);
  }
  return columns;
}

/**
 * Pass 3 — Try every (from-column, item, to-column) swap. Accept any move
 * that strictly reduces variance. Restart the scan after each accepted move.
 *
 * Worst-case O(N² × C²) per outer pass, but the inner loops short-circuit on
 * the first improvement so real-world runs converge in a few outer passes.
 * Cap at items.length to be safe.
 */
function rebalance(columns: Slot[][], gap: number): Slot[][] {
  const cols = columns.map((c) => [...c]);
  const cap = cols.reduce((n, c) => n + c.length, 0) * 2;

  outer: for (let iter = 0; iter < cap; iter++) {
    const before = variance(cols, gap);
    for (let from = 0; from < cols.length; from++) {
      const fromCol = cols[from]!;
      for (let idx = 0; idx < fromCol.length; idx++) {
        for (let to = 0; to < cols.length; to++) {
          if (to === from) continue;
          // Try moving fromCol[idx] to end of cols[to]
          const slot = fromCol[idx]!;
          fromCol.splice(idx, 1);
          cols[to]!.push(slot);
          const after = variance(cols, gap);
          if (after < before - 0.001) {
            // Accept and restart full scan
            continue outer;
          }
          // Revert
          cols[to]!.pop();
          fromCol.splice(idx, 0, slot);
        }
      }
    }
    // No improving move found this pass; we're locally optimal.
    break;
  }

  return cols;
}

/**
 * Pass 4 — Sort each column's contents by original API order. Column
 * heights are unchanged (sums commute).
 */
function restoreOrder(columns: Slot[][]): Slot[][] {
  return columns.map((c) => [...c].sort((a, b) => a.order - b.order));
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
      return { columnCount: 0, columnWidth: 0, columns: [] as Slot[][] };
    }
    const columnCount = pickColumnCount(containerWidth, breakpoints);
    const columnWidth = (containerWidth - gap * (columnCount - 1)) / columnCount;

    // Build slots with predicted heights, tagged with original API index.
    const slots: Slot[] = items.map((item, order) => {
      const ratio = item.aspectRatio && item.aspectRatio > 0 ? item.aspectRatio : 1;
      return { item, height: columnWidth / ratio, order };
    });

    // Pass 1: sort tallest-first so outliers get placed early.
    const sorted = [...slots].sort((a, b) => b.height - a.height);
    // Pass 2: greedy shortest-column.
    const greedy = greedyPlace(sorted, columnCount, gap);
    // Pass 3: local-search rebalance.
    const balanced = rebalance(greedy, gap);
    // Pass 4: restore reading order within each column.
    const ordered = restoreOrder(balanced);

    return { columnCount, columnWidth, columns: ordered };
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
              {col.map((s) => (
                <div key={s.item.key}>{s.item.node}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
