import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApproveInput } from "@ip/shared";
import { useSession } from "../../lib/hooks/useSession.ts";
import { useApproveSubmission } from "../../lib/hooks/useApproveSubmission.ts";
import { useRejectSubmission } from "../../lib/hooks/useRejectSubmission.ts";
import { toast } from "../../lib/toast.ts";
import AdminEditPanel from "./AdminEditPanel.tsx";
import RejectReasonModal from "./RejectReasonModal.tsx";

type Edits = NonNullable<ApproveInput["edits"]>;
type Props = { submissionId: string; onResolved: () => void };

export default function AdminActionBar({ submissionId, onResolved }: Props) {
  const { t } = useTranslation();
  const session = useSession();
  const role = (session.data?.user as { role?: string } | undefined)?.role ?? "user";
  const isAdmin = role === "admin";
  const [editMode, setEditMode] = useState(false);
  const [edits, setEdits] = useState<Edits>({});
  const [showReject, setShowReject] = useState(false);

  const approve = useApproveSubmission({
    onSuccess: () => {
      toast.success(t("admin.approved_toast"));
      onResolved();
    },
    onError: (code) => {
      const key = code === "edits_require_admin" ? "moderator_no_edit"
        : code === "not_pending" ? "error.not_pending"
        : code === "image_migration_failed" ? "error.migration"
        : null;
      toast.error(key ? t(`admin.${key}`) : t("submit.error.generic"));
    },
  });
  const reject = useRejectSubmission({
    onSuccess: () => {
      toast.success(t("admin.rejected_toast"));
      setShowReject(false);
      onResolved();
    },
    onError: (code) => {
      toast.error(code === "not_pending" ? t("admin.error.not_pending") : t("submit.error.generic"));
    },
  });

  return (
    <div className="space-y-3">
      {isAdmin && (
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={editMode}
            onChange={(e) => setEditMode(e.target.checked)}
          />
          {t("admin.edit_toggle")}
        </label>
      )}
      {editMode && <AdminEditPanel initial={edits} onChange={setEdits} />}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => approve.mutate({ id: submissionId, edits: editMode ? edits : {} })}
          disabled={approve.isPending}
          className="rounded-card bg-green-600 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {approve.isPending ? t("admin.approving") : editMode ? t("admin.approve_with_edits") : t("admin.approve")}
        </button>
        <button
          type="button"
          onClick={() => setShowReject(true)}
          className="rounded-card bg-red-500 px-4 py-1.5 text-sm font-medium text-white"
        >
          {t("admin.reject")}
        </button>
      </div>
      <RejectReasonModal
        open={showReject}
        onClose={() => setShowReject(false)}
        onSubmit={(reason) => reject.mutate({ id: submissionId, reason })}
        isSubmitting={reject.isPending}
      />
    </div>
  );
}
