import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { useMySubmissions } from "../../lib/hooks/useMySubmissions.ts";
import SubmissionCard from "./SubmissionCard.tsx";

export default function MySubmissionsTab() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const highlightId = params.get("highlight");
  const query = useMySubmissions("all");

  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById(`submission-${highlightId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (query.hasNextPage && (query.data?.pages.length ?? 0) < 5) {
      void query.fetchNextPage();
    }
  }, [highlightId, query.data?.pages.length, query.hasNextPage, query.fetchNextPage, query]);

  if (query.isLoading) return <p className="text-sm text-ink/60">{t("common.loading")}</p>;
  const all = (query.data?.pages ?? []).flatMap((p) => p.items);
  if (all.length === 0)
    return <p className="text-sm text-ink/60">{t("my_submissions.empty")}</p>;

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
        {all.map((item) => (
          <SubmissionCard key={item.id} item={item} highlight={item.id === highlightId} />
        ))}
      </div>
      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="mt-4 rounded-card border border-border-soft px-3 py-1.5 text-sm"
        >
          {query.isFetchingNextPage
            ? t("common.loading")
            : t("common.load_more", { defaultValue: "Load more" })}
        </button>
      )}
    </div>
  );
}
