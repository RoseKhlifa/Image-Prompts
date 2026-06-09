import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Github, Twitter, Globe } from "lucide-react";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import Modal from "../modals/Modal";
import { ApiError } from "../../lib/api";
import { toast } from "../../lib/toast";
import {
  useSetMyPins,
  useUpdateMyProfile,
} from "../../lib/hooks/useMyProfile";
import type { UserPublic } from "../../lib/hooks/useUser";
import { useUserPrompts } from "../../lib/hooks/useUserPrompts";

type Props = {
  open: boolean;
  onClose: () => void;
  user: UserPublic;
};

type Tab = "basic" | "pins";

/**
 * Modal for the signed-in user to edit their own bio + social links and
 * choose up to 3 pinned prompts.
 *
 * UI judgment call: pinned order is the click order (1st clicked = order 0).
 * To handle a fast click+click+click without flicker, we keep a single source
 * of truth (`selectedIds: string[]`) updated synchronously on each toggle.
 * A click that would push count past 3 is rejected; the user must unselect
 * an existing pick first. This is simpler than a drag-reorder UI and good
 * enough for "max 3" semantics.
 */
export default function ProfileEditModal({ open, onClose, user }: Props) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [tab, setTab] = useState<Tab>("basic");

  // Form state for bio + social. Seed from the user prop each time the modal
  // opens so re-opening after cancel discards in-flight edits.
  const [bioZh, setBioZh] = useState("");
  const [bioEn, setBioEn] = useState("");
  const [github, setGithub] = useState("");
  const [twitter, setTwitter] = useState("");
  const [bilibili, setBilibili] = useState("");
  const [website, setWebsite] = useState("");

  // Selected pin ids in click-order. Cap is enforced at toggle time, NOT in
  // the array — that lets us show the order chip "1 / 2 / 3" correctly.
  const initialPinIds = useMemo(
    () => user.pinnedPrompts.map((p) => p.id),
    [user.pinnedPrompts],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(initialPinIds);

  useEffect(() => {
    if (!open) return;
    setBioZh(user.bio?.zh ?? "");
    setBioEn(user.bio?.en ?? "");
    setGithub(user.socialLinks?.github ?? "");
    setTwitter(user.socialLinks?.twitter ?? "");
    setBilibili(user.socialLinks?.bilibili ?? "");
    setWebsite(user.socialLinks?.website ?? "");
    setSelectedIds(initialPinIds);
    setTab("basic");
  }, [open, user, initialPinIds]);

  const updateProfile = useUpdateMyProfile(user.id);
  const setPins = useSetMyPins(user.id);
  const myPrompts = useUserPrompts(user.id);

  async function handleSave() {
    try {
      if (tab === "basic") {
        await updateProfile.mutateAsync({
          bio: { zh: bioZh, en: bioEn },
          socialLinks: {
            github,
            twitter,
            bilibili,
            website,
          },
        });
      } else {
        await setPins.mutateAsync({ promptIds: selectedIds.slice(0, 3) });
      }
      toast.success(t("profile.save_success"));
      onClose();
    } catch (e) {
      // Highlight which field broke when the server returns a per-slot or
      // validation error. The ApiError fields/message carry the slot name —
      // toast it so the user knows what to fix.
      if (e instanceof ApiError) {
        const fieldsStr = e.fields
          ? Object.entries(e.fields)
              .map(([k, v]) => `${k}: ${v}`)
              .join("; ")
          : "";
        if (fieldsStr) {
          toast.error(`${t("profile.save_failed")} — ${fieldsStr}`);
        } else if (e.message) {
          toast.error(`${t("profile.save_failed")} — ${e.message}`);
        } else {
          toast.error(t("profile.save_failed"));
        }
      } else {
        toast.error(t("profile.save_failed"));
      }
    }
  }

  function togglePin(id: string) {
    setSelectedIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      // Reject when already at max; the user must remove one first.
      if (cur.length >= 3) return cur;
      return [...cur, id];
    });
  }

  const saving = updateProfile.isPending || setPins.isPending;

  return (
    <Modal open={open} onClose={onClose} title={t("profile.edit_modal_title")}>
      <div className="flex flex-col gap-4">
        {/* Tabs */}
        <div role="tablist" className="flex gap-3 border-b border-border-soft">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "basic"}
            onClick={() => setTab("basic")}
            className={`-mb-px border-b-2 px-3 pb-2 text-[13px] font-medium transition ${
              tab === "basic"
                ? "border-accent text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t("profile.edit_tab_basic")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "pins"}
            onClick={() => setTab("pins")}
            className={`-mb-px border-b-2 px-3 pb-2 text-[13px] font-medium transition ${
              tab === "pins"
                ? "border-accent text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t("profile.edit_tab_pins")}
          </button>
        </div>

        {tab === "basic" ? (
          <div className="flex flex-col gap-3">
            <Field label={t("profile.bio_zh_label")}>
              <textarea
                value={bioZh}
                onChange={(e) => setBioZh(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder={t("profile.bio_placeholder")}
                className="w-full rounded-md border border-border-soft bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
              />
            </Field>
            <Field label={t("profile.bio_en_label")}>
              <textarea
                value={bioEn}
                onChange={(e) => setBioEn(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder={t("profile.bio_placeholder")}
                className="w-full rounded-md border border-border-soft bg-surface px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
              />
            </Field>
            <div className="my-2 border-t border-border-soft" />
            <Field label={t("profile.social_github")}>
              <UrlInput value={github} onChange={setGithub} icon={<Github size={14} />} />
            </Field>
            <Field label={t("profile.social_twitter")}>
              <UrlInput value={twitter} onChange={setTwitter} icon={<Twitter size={14} />} />
            </Field>
            <Field label={t("profile.social_bilibili")}>
              <UrlInput
                value={bilibili}
                onChange={setBilibili}
                icon={
                  <span className="inline-flex h-[14px] w-[14px] items-center justify-center text-[9px] font-bold">
                    B
                  </span>
                }
              />
            </Field>
            <Field label={t("profile.social_website")}>
              <UrlInput value={website} onChange={setWebsite} icon={<Globe size={14} />} />
            </Field>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] text-ink-dim">{t("profile.pinned_hint")}</p>
            <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border-soft">
              {myPrompts.isLoading ? (
                <div className="p-4 text-center text-[12px] text-ink-dim">
                  {t("common.loading")}
                </div>
              ) : (myPrompts.data?.items.length ?? 0) === 0 ? (
                <div className="p-4 text-center text-[12px] text-ink-dim">
                  {t("profile.pinned_empty")}
                </div>
              ) : (
                <ul className="divide-y divide-border-soft">
                  {(myPrompts.data?.items ?? []).map((p) => {
                    const checked = selectedIds.includes(p.id);
                    const orderIdx = selectedIds.indexOf(p.id);
                    const isMaxAndUnchecked =
                      !checked && selectedIds.length >= 3;
                    const title = pickBilingual(p.title, locale) ?? p.slug;
                    return (
                      <li
                        key={p.id}
                        className={`flex items-center gap-2 p-2 ${
                          isMaxAndUnchecked ? "opacity-50" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => togglePin(p.id)}
                          disabled={isMaxAndUnchecked}
                          className="flex h-5 w-5 items-center justify-center rounded border border-border-soft text-[11px] font-semibold text-white"
                          aria-checked={checked}
                          role="checkbox"
                          style={{
                            backgroundColor: checked
                              ? "var(--accent, #6366f1)"
                              : "transparent",
                          }}
                        >
                          {checked ? orderIdx + 1 : ""}
                        </button>
                        <span className="line-clamp-1 flex-1 text-[13px] text-ink">
                          {title}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2 border-t border-border-soft pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border-soft bg-surface px-3 py-1.5 text-[13px] text-ink hover:bg-panel-2 disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? t("common.loading") : t("common.save")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

function UrlInput({
  value,
  onChange,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border-soft bg-surface px-2.5 py-1.5 focus-within:border-accent">
      <span className="text-ink-muted">{icon}</span>
      <input
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={400}
        placeholder="https://..."
        className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-dim focus:outline-none"
      />
    </div>
  );
}
