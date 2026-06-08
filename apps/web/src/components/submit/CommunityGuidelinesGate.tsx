import { useState, type ReactNode } from "react";
import { useCommunityGuidelinesGate } from "../../lib/hooks/useCommunityGuidelinesGate";
import CommunityGuidelinesModal from "./CommunityGuidelinesModal";

type Props = {
  children: ReactNode;
  /** When the user cancels the modal, where to go (defaults to history.back()). */
  onCancel?: () => void;
};

/**
 * Wraps a submission UI (e.g. SubmissionForm) and shows the community
 * guidelines modal whenever the authenticated user has not yet accepted the
 * current version. While the modal is open the children remain visible behind
 * it as opacity-50 + pointer-events-none — a deliberate visual signal that
 * the form is locked until the user either accepts or cancels.
 *
 * Anonymous users and users whose accepted version is already current see
 * the children pass through unchanged.
 */
export default function CommunityGuidelinesGate({ children, onCancel }: Props) {
  const { needsAccept, isAuthed, isLoading } = useCommunityGuidelinesGate();
  const [open, setOpen] = useState(true);

  if (isLoading || !isAuthed) return <>{children}</>;
  if (!needsAccept) return <>{children}</>;

  return (
    <>
      <div className="pointer-events-none opacity-50">{children}</div>
      <CommunityGuidelinesModal
        open={open}
        onCancel={() => {
          setOpen(false);
          if (onCancel) onCancel();
          else if (needsAccept) window.history.back();
        }}
        onAccepted={() => {
          // Just close THIS modal. useCommunityGuidelinesGate will re-read the
          // session (invalidated by useAcceptGuidelines.onSuccess) and on next
          // render `needsAccept` flips false, letting the children render. Do
          // NOT call onCancel here — that would close the parent submit modal
          // and undo the user's intent to actually submit.
          setOpen(false);
        }}
      />
    </>
  );
}
