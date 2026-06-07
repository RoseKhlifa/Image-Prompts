import type { ImportTokenPayload } from "@ip/shared";

type Props = {
  open: boolean;
  onClose: () => void;
  prompt: ImportTokenPayload["prompt"];
};

// Stub — Task 20 fills in the real modal. Returns null so SendToStudioButton
// can import + reference it for now.
export default function StudioNotInstalledModal(_props: Props) {
  return null;
}
