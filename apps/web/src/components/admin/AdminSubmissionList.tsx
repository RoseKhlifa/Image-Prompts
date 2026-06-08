import { useTranslation } from "react-i18next";
import { useAdminSubmissions } from "../../lib/hooks/useAdminSubmissions.ts";
import AdminSubmissionRow from "./AdminSubmissionRow.tsx";

type Status = "pending" | "approved" | "rejected";

type Props = {
  status: Status;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export default function AdminSubmissionList({ status, selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const query = useAdminSubmissions(status);

  if (query.isLoading) return <p className="text-sm text-ink/60">{t("common.loading")}</p>;
  const items = (query.data?.pages ?? []).flatMap((p) => p.items);
  if (items.length === 0)
    return <p className="text-sm text-ink/60">{t(`admin.empty_${status}`)}</p>;

  return (
    <div className="space-y-2">
      {items.map((it) => (
        <AdminSubmissionRow
          key={it.id}
          item={it}
          selected={selectedId === it.id}
          onSelect={() => onSelect(it.id)}
        />
      ))}
      {query.hasNextPage && (
        <button
          type="button"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className="block w-full rounded-card border border-border-soft px-3 py-1.5 text-sm"
        >
          {query.isFetchingNextPage ? t("common.loading") : "Load more"}
        </button>
      )}
    </div>
  );
}
