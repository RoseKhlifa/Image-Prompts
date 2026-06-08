import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useImageUpload } from "../../lib/hooks/useImageUpload.ts";
import { useR2PoolMap } from "../../lib/hooks/useR2Pool.ts";
import { resolveImageUrl } from "../../lib/imageUrl.ts";

export type SlotValue = { r2AccountId: string; r2Key: string };

type Props = {
  value: SlotValue | null;
  onChange: (v: SlotValue | null) => void;
};

export default function ImageSlot({ value, onChange }: Props) {
  const { t } = useTranslation();
  const upload = useImageUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const { map } = useR2PoolMap();

  useEffect(() => {
    if (upload.state === "done" && upload.r2AccountId && upload.r2Key) {
      onChange({ r2AccountId: upload.r2AccountId, r2Key: upload.r2Key });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload.state, upload.r2AccountId, upload.r2Key]);

  if (value) {
    const url = resolveImageUrl(
      { r2AccountId: value.r2AccountId, r2Key: value.r2Key },
      map,
    );
    return (
      <div className="relative aspect-square rounded-card overflow-hidden border border-border-soft">
        <img src={url} alt="" className="h-full w-full object-cover" />
        <button
          type="button"
          onClick={() => {
            onChange(null);
            upload.reset();
          }}
          className="absolute top-1 right-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white"
        >
          {t("submit.image_delete")}
        </button>
      </div>
    );
  }

  if (
    upload.state === "uploading" ||
    upload.state === "presigning" ||
    upload.state === "validating"
  ) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-card border border-dashed border-border-soft text-xs text-ink/60">
        {t("submit.image_uploading")}
      </div>
    );
  }

  if (upload.state === "failed") {
    return (
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex aspect-square items-center justify-center rounded-card border border-dashed border-red-400 text-xs text-red-600"
      >
        {upload.error
          ? t(`submit.error.${upload.error.split(":")[0]}`, {
              defaultValue: t("submit.image_failed"),
            })
          : t("submit.image_failed")}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload.upload(f);
          }}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      className="flex aspect-square flex-col items-center justify-center gap-1 rounded-card border border-dashed border-border-soft text-xs text-ink/60 hover:border-accent"
    >
      <span>{t("submit.image_drop_hint")}</span>
      <span className="text-[10px]">{t("submit.image_constraints")}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload.upload(f);
        }}
      />
    </button>
  );
}
