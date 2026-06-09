import { useTranslation } from "react-i18next";
import ImageSlot, { type SlotValue } from "./ImageSlot.tsx";

// Image slot cap. Matches the server's owner-prompts/submissions cap of 10 so
// the form never lets the user upload an image the server would reject. The
// public submission flow has a separate server-side limit (5 in the shared
// SubmissionInputSchema) which still applies — the form just shows up to 10
// slots; the schema validates on submit.
const MAX = 10;

type Props = {
  value: SlotValue[];
  onChange: (v: SlotValue[]) => void;
};

export default function ImageUploadGrid({ value, onChange }: Props) {
  const { t } = useTranslation();
  // Always render value.length + 1 slots (capped at MAX). The trailing slot is empty.
  const slotCount = Math.min(MAX, value.length + 1);
  const slots: Array<SlotValue | null> = [];
  for (let i = 0; i < slotCount; i++) {
    slots.push(i < value.length ? value[i]! : null);
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {slots.map((s, idx) => (
          <ImageSlot
            key={idx}
            value={s}
            onChange={(next) => {
              if (next === null) {
                // remove this slot
                onChange(value.filter((_, i) => i !== idx));
              } else {
                const copy = [...value];
                if (idx < copy.length) copy[idx] = next;
                else copy.push(next);
                onChange(copy);
              }
            }}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-ink/60">
        {t("submit.uploaded_count", { done: value.length, total: MAX })}
      </p>
    </div>
  );
}
