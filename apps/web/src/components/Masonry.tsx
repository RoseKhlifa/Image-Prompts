import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PromptSummary } from "@ip/shared";
import { resolveImageUrl } from "../lib/imageUrl";

/**
 * Image-aware masonry.
 *
 * Items can be passed with `aspectRatio` known up-front (e.g. when the API
 * already carries `primaryImage.width/height`), OR with an `imageUrl` for
 * the component to measure on the fly via `new Image()`. Imported prompts
 * carry remote URLs but no dimensions; without on-the-fly measurement the
 * algorithm thinks every item is square (the 1.0 fallback) and produces
 * the "single column runaway" / "diagonal gap band" the user reported.
 *
 * Algorithm:
 *   1. Preload — for every item with an imageUrl and no measured ratio yet,
 *      kick off `new Image()`. Capture `naturalWidth / naturalHeight`.
 *      Cache by `item.key` so re-renders / paginations don't re-measure.
 *      Errors fall back to a sensible portrait-ish ratio (0.75).
 *   2. Greedy place — once all items have a ratio (provided OR measured),
 *      compute predicted heights and feed them through a tallest-first
 *      pre-sort + shortest-column greedy placement.
 *   3. Local rebalance — try every (from-column, item, to-column) move;
 *      accept the first that strictly reduces variance; restart. Capped at
 *      2 × N moves so it always terminates.
 *   4. Restore reading order — re-sort each column by original API index
 *      so visually-earlier items appear higher in their column. Column
 *      heights are unaffected (sums commute).
 *
 * While any items are still pending measurement, the component shows a
 * uniform-card placeholder grid of the same column count instead of laying
 * out half-measured items (which would re-flow once the missing ratios
 * arrive). The cached ratio map persists across pagination so revisiting
 * a prior page doesn't trigger re-preload.
 *
 * Image aspect ratios are NEVER distorted. Only column assignment changes.
 */

export type MasonryItem = {
  /** Stable identity for React reconciliation + measurement cache key. */
  key: string;
  /** width / height. If absent, the component preloads `imageUrl`. */
  aspectRatio?: number;
  /** Image URL preloaded to measure dimensions when aspectRatio is absent. */
  imageUrl?: string;
  /** Rendered content. */
  node: ReactNode;
};

/**
 * Build a MasonryItem from a PromptSummary. Uses API-provided dimensions
 * when available; otherwise hands the resolved image URL to Masonry so
 * it can preload + measure. Callers that need a custom `key` or `node`
 * (e.g. pinned-vs-works distinction in UserPage) can spread the result
 * and override.
 */
export function buildMasonryItem(
  prompt: PromptSummary,
  r2Map: Map<string, string>,
  node: ReactNode,
  keyOverride?: string,
): MasonryItem {
  const knownRatio =
    prompt.primaryImage?.width && prompt.primaryImage?.height
      ? prompt.primaryImage.width / prompt.primaryImage.height
      : undefined;
  const imageUrl = knownRatio
    ? undefined
    : resolveImageUrl(prompt.primaryImage, r2Map);
  return {
    key: keyOverride ?? prompt.id,
    ...(knownRatio !== undefined ? { aspectRatio: knownRatio } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    node,
  };
}

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

const ERROR_FALLBACK_RATIO = 0.75; // sensible portrait-ish guess when an image fails

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
          const slot = fromCol[idx]!;
          fromCol.splice(idx, 1);
          cols[to]!.push(slot);
          const after = variance(cols, gap);
          if (after < before - 0.001) {
            continue outer;
          }
          cols[to]!.pop();
          fromCol.splice(idx, 0, slot);
        }
      }
    }
    break;
  }

  return cols;
}

function restoreOrder(columns: Slot[][]): Slot[][] {
  return columns.map((c) => [...c].sort((a, b) => a.order - b.order));
}

export default function Masonry({ items, breakpoints, gap = 4, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  // Cached natural-aspect ratios keyed on `item.key`. Persists across
  // re-renders so paginated/load-more flows don't re-preload.
  const [measuredRatios, setMeasuredRatios] = useState<Map<string, number>>(
    () => new Map(),
  );

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

  // Preload images whose aspect ratio we don't know yet.
  useEffect(() => {
    const toLoad = items.filter(
      (i) =>
        !i.aspectRatio &&
        !!i.imageUrl &&
        !measuredRatios.has(i.key),
    );
    if (toLoad.length === 0) return;

    let cancelled = false;
    Promise.allSettled(
      toLoad.map(
        (item) =>
          new Promise<[string, number]>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              const r =
                img.naturalHeight > 0
                  ? img.naturalWidth / img.naturalHeight
                  : ERROR_FALLBACK_RATIO;
              resolve([item.key, r > 0 ? r : ERROR_FALLBACK_RATIO]);
            };
            img.onerror = () => reject(item.key);
            img.src = item.imageUrl!;
          }),
      ),
    ).then((results) => {
      if (cancelled) return;
      setMeasuredRatios((prev) => {
        const next = new Map(prev);
        for (const r of results) {
          if (r.status === "fulfilled") {
            const [k, ratio] = r.value;
            next.set(k, ratio);
          } else {
            const k = r.reason as string;
            next.set(k, ERROR_FALLBACK_RATIO);
          }
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [items, measuredRatios]);

  // An item is "ready" if we know its ratio: either passed in by the caller
  // (e.g. from API width/height), or we measured it via preload above, or it
  // has no imageUrl to preload (rendered as 1:1 fallback).
  const allReady = useMemo(
    () =>
      items.every(
        (i) => i.aspectRatio || !i.imageUrl || measuredRatios.has(i.key),
      ),
    [items, measuredRatios],
  );

  const columnCount =
    containerWidth > 0 ? pickColumnCount(containerWidth, breakpoints) : 0;
  const columnWidth =
    containerWidth > 0 && columnCount > 0
      ? (containerWidth - gap * (columnCount - 1)) / columnCount
      : 0;

  const layout = useMemo(() => {
    if (!allReady || columnWidth <= 0 || items.length === 0) {
      return [] as Slot[][];
    }
    const slots: Slot[] = items.map((item, order) => {
      const ratio =
        item.aspectRatio ?? measuredRatios.get(item.key) ?? 1;
      return { item, height: columnWidth / ratio, order };
    });
    const sorted = [...slots].sort((a, b) => b.height - a.height);
    const greedy = greedyPlace(sorted, columnCount, gap);
    const balanced = rebalance(greedy, gap);
    return restoreOrder(balanced);
  }, [allReady, items, columnWidth, columnCount, gap, measuredRatios]);

  return (
    <div ref={containerRef} className={className}>
      {columnCount > 0 && (!allReady || layout.length === 0) && items.length > 0 ? (
        // Placeholder grid while preloading. Same column count as the real
        // layout so the transition is visually quiet.
        <div className="flex" style={{ gap: `${gap}px` }}>
          {Array.from({ length: columnCount }).map((_, ci) => (
            <div
              key={ci}
              className="flex min-w-0 flex-col"
              style={{ width: `${columnWidth}px`, gap: `${gap}px` }}
            >
              {Array.from({ length: 4 }).map((_, ri) => (
                <div
                  key={ri}
                  className="aspect-[3/4] w-full animate-pulse rounded-md bg-panel"
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        columnCount > 0 &&
        layout.length > 0 && (
          <div className="flex" style={{ gap: `${gap}px` }}>
            {layout.map((col, ci) => (
              <div
                key={ci}
                className="flex min-w-0 flex-col"
                style={{ width: `${columnWidth}px`, gap: `${gap}px` }}
              >
                {col.map((s) => (
                  <div key={s.item.key}>{s.item.node}</div>
                ))}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
