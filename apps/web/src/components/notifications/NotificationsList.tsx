import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { isLocale, type Locale, type NotificationDTO } from "@ip/shared";
import { useNotifications } from "../../lib/hooks/useNotifications.ts";
import {
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "../../lib/hooks/useMarkNotificationRead.ts";
import { withLocale } from "../../lib/locale.ts";

type Props = { onItemNavigate: () => void };

export default function NotificationsList({ onItemNavigate }: Props) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const list = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const navigate = useNavigate();

  function navigateFor(n: NotificationDTO) {
    const p = n.payload as { promptSlug?: string; submissionId?: string };
    if (n.type === "submission_approved" && p.promptSlug) {
      navigate(withLocale(locale, `/prompts/${p.promptSlug}`));
    } else if (n.type === "submission_rejected" && p.submissionId) {
      navigate(withLocale(locale, `/profile?tab=submissions&highlight=${p.submissionId}`));
    }
  }

  if (list.isLoading) return <div className="p-3 text-xs text-ink/60">{t("common.loading")}</div>;
  const items = list.data?.items ?? [];
  if (items.length === 0) return <div className="p-3 text-xs text-ink/60">{t("notifications.empty")}</div>;

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border-soft p-2">
        <span className="text-xs font-semibold text-ink">{t("notifications.title")}</span>
        <button
          type="button"
          onClick={() => markAll.mutate()}
          className="text-[11px] text-accent hover:underline"
        >
          {t("notifications.mark_all_read")}
        </button>
      </div>
      <ul className="max-h-80 overflow-y-auto">
        {items.map((n) => {
          const p = n.payload as { titleZh?: string; titleEn?: string };
          const title = (locale === "zh" ? p.titleZh ?? p.titleEn : p.titleEn ?? p.titleZh) ?? "";
          const msgKey = n.type === "submission_approved"
            ? "notifications.submission_approved"
            : "notifications.submission_rejected";
          return (
            <li key={n.id} className={n.readAt ? "opacity-60" : ""}>
              <button
                type="button"
                onClick={() => {
                  markRead.mutate(n.id);
                  navigateFor(n);
                  onItemNavigate();
                }}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-ink/5"
              >
                {t(msgKey, { title })}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
