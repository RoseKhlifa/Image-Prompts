import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import AppShell from "../components/layout/AppShell";
import Sidebar from "../components/layout/Sidebar";
import Toolbar from "../components/Toolbar";
import PromptCard from "../components/PromptCard";
import { CardGridSkeleton } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import Pagination from "../components/Pagination";
import { NsfwGateModal } from "../components/NsfwGateModal";
import { usePromptList } from "../lib/hooks/usePromptList";
import { useR2PoolMap } from "../lib/hooks/useR2Pool";
import { withLocale } from "../lib/locale";
import Masonry, {
  buildMasonryItem,
  type MasonryBreakpoint,
} from "../components/Masonry";
import { isLocale, type Locale, type SortOption, type AspectRatio } from "@ip/shared";

const NSFW_ACK_KEY = "nsfw-ack";

function readNsfwAck(): boolean {
  try {
    return sessionStorage.getItem(NSFW_ACK_KEY) === "1";
  } catch {
    return false;
  }
}

const SORT_VALUES: readonly SortOption[] = ["latest", "popular", "liked", "sent"];
const ASPECT_VALUES: readonly AspectRatio[] = ["auto", "1:1", "3:2", "2:3", "16:9", "9:16"];

const BREAKPOINTS: MasonryBreakpoint[] = [
  { minWidth: 1280, columns: 5 },
  { minWidth: 1024, columns: 4 },
  { minWidth: 768, columns: 3 },
  { minWidth: 640, columns: 2 },
  { minWidth: 0, columns: 1 },
];

function asSort(v: string | null): SortOption {
  return SORT_VALUES.includes(v as SortOption) ? (v as SortOption) : "latest";
}

function asAspect(v: string | null): AspectRatio | undefined {
  return ASPECT_VALUES.includes(v as AspectRatio) ? (v as AspectRatio) : undefined;
}

export default function PromptListPage() {
  const [params, setParams] = useSearchParams();
  const { locale: localeParam, slug: routeSlug } = useParams<{
    locale?: string;
    slug?: string;
  }>();
  const navigate = useNavigate();
  const locale: Locale = isLocale(localeParam) ? localeParam : "zh";
  // Category can come from either the route param (/categories/:slug) or the
  // query string (/prompts?category=...) — Sidebar uses the latter, but the
  // route mounts both.
  const category = routeSlug ?? params.get("category") ?? undefined;
  const tag = params.get("tag") ?? undefined;
  const aspect = asAspect(params.get("aspect"));
  const q = params.get("q") ?? undefined;
  const sort = asSort(params.get("sort"));
  const page = Number(params.get("page") ?? "1") || 1;

  const isNsfwCategory = category === "nsfw";
  const [nsfwAcked, setNsfwAcked] = useState<boolean>(() => readNsfwAck());
  const gateBlocking = isNsfwCategory && !nsfwAcked;
  const { map: r2Map } = useR2PoolMap();

  const query = useMemo(
    () => ({ category, tag, aspect, q, sort, page, pageSize: 24 }),
    [category, tag, aspect, q, sort, page],
  );
  // Skip the fetch entirely while the gate is up — no point hitting the API
  // before the visitor acknowledges.
  const list = usePromptList(query, { enabled: !gateBlocking });

  if (gateBlocking) {
    return (
      <NsfwGateModal
        onConfirm={() => {
          try {
            sessionStorage.setItem(NSFW_ACK_KEY, "1");
          } catch {
            // ignore — gate still unlocks for this render, just won't persist
          }
          setNsfwAcked(true);
        }}
        onCancel={() => {
          if (window.history.length > 1) {
            navigate(-1);
          } else {
            navigate(withLocale(locale, "/prompts"));
          }
        }}
      />
    );
  }

  function setSort(next: SortOption) {
    const updated = new URLSearchParams(params);
    updated.set("sort", next);
    updated.delete("page");
    setParams(updated);
  }

  function setPage(next: number) {
    const updated = new URLSearchParams(params);
    if (next <= 1) updated.delete("page");
    else updated.set("page", String(next));
    setParams(updated);
  }

  return (
    <AppShell sidebar={<Sidebar />}>
      <Toolbar total={list.data?.total ?? 0} sort={sort} onSortChange={setSort} />
      {list.isLoading && <CardGridSkeleton count={12} />}
      {list.isError && (
        <ErrorState
          message={list.error instanceof Error ? list.error.message : undefined}
          onRetry={() => list.refetch()}
        />
      )}
      {!list.isLoading &&
        !list.isError &&
        list.data &&
        (list.data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <Masonry
              items={list.data.items.map((p) =>
                buildMasonryItem(p, r2Map, <PromptCard prompt={p} />),
              )}
              breakpoints={BREAKPOINTS}
              gap={4}
              className="p-2"
            />
            <Pagination
              page={page}
              hasMore={list.data.hasMore}
              total={list.data.total}
              pageSize={list.data.pageSize}
              onChange={setPage}
            />
          </>
        ))}
    </AppShell>
  );
}

