import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { Link } from "react-router";
import { Github, Twitter, Globe } from "lucide-react";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import AvatarBadge from "../auth/AvatarBadge";
import { useInvalidateSession, type Session } from "../../lib/hooks/useSession";
import { useUser } from "../../lib/hooks/useUser";
import { signOut } from "../../lib/auth";
import { toast } from "../../lib/toast";
import { withLocale } from "../../lib/locale";
import { resolveImageUrl } from "../../lib/imageUrl";
import { useR2PoolMap } from "../../lib/hooks/useR2Pool";
import ProfileEditModal from "./ProfileEditModal";

export default function ProfileInfoTab({ session }: { session: Session }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const invalidate = useInvalidateSession();
  // Pull the public profile slice (bio / socialLinks / pinnedPrompts) so we
  // can render them here without the parent having to plumb them through.
  // useUser shares the ["user", id] cache key with UserPage, so a save from
  // either surface invalidates both.
  const user = useUser(session.user.id);
  const [editOpen, setEditOpen] = useState(false);
  const { map } = useR2PoolMap();

  async function handleSignOut() {
    await signOut();
    await invalidate();
    toast.info(t("auth.sign_out"));
    navigate(withLocale(locale, "/"), { replace: true });
  }

  const u = session.user;
  const bio = user.data?.bio ? pickBilingual(user.data.bio, locale) : null;
  const socialLinks = user.data?.socialLinks ?? null;
  const pinned = user.data?.pinnedPrompts ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-col gap-5 rounded-card border border-border-soft bg-panel p-6">
        {/* Compact identity block — avatar + name + email side by side. */}
        <div className="flex items-center gap-3">
          <AvatarBadge src={u.image} name={u.name} email={u.email} size={48} />
          <div className="flex flex-col">
            {u.name && (
              <div className="text-[15px] font-medium text-ink">{u.name}</div>
            )}
            <div className="text-[12px] text-ink-muted">{u.email}</div>
          </div>
        </div>

        {/* Bio */}
        <section>
          <div className="mb-1.5 text-[11px] font-medium text-ink-muted">
            {t("profile.bio_label")}
          </div>
          {bio ? (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
              {bio}
            </p>
          ) : (
            <p className="text-[12px] text-ink-dim">{t("profile.bio_empty")}</p>
          )}
        </section>

        {/* Social */}
        <section>
          <div className="mb-1.5 text-[11px] font-medium text-ink-muted">
            {t("profile.social_label")}
          </div>
          <SocialRow links={socialLinks} />
        </section>

        <div>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            disabled={!user.data}
            className="rounded-md border border-border-soft bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-panel-2 disabled:opacity-50"
          >
            {t("profile.edit_button")}
          </button>
        </div>

        {/* Pinned */}
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[11px] font-medium text-ink-muted">
              {t("profile.pinned_label")}
            </div>
          </div>
          {pinned.length === 0 ? (
            <p className="text-[12px] text-ink-dim">{t("profile.pinned_empty")}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {pinned.map((p) => {
                const title = pickBilingual(p.title, locale) ?? p.slug;
                const imgUrl = resolveImageUrl(p.primaryImage, map);
                return (
                  <li key={p.id}>
                    <Link
                      to={withLocale(locale, `/prompts/${p.slug}`)}
                      className="flex items-center gap-2 rounded-md border border-border-soft bg-surface px-2 py-1.5 text-[12px] text-ink hover:border-accent/40"
                    >
                      <img
                        src={imgUrl}
                        alt={title}
                        width={28}
                        height={28}
                        className="rounded object-cover"
                      />
                      <span className="line-clamp-1 max-w-[12rem]">{title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              disabled={!user.data}
              className="rounded-md border border-border-soft bg-surface px-3 py-1.5 text-[12px] font-medium text-ink hover:bg-panel-2 disabled:opacity-50"
            >
              {t("profile.edit_pins_button")}
            </button>
          </div>
        </section>

        <div className="border-t border-border-soft pt-3">
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-pill border border-border-soft bg-surface px-3 py-1 text-[12px] text-ink hover:bg-panel-2"
          >
            {t("profile.sign_out_button")}
          </button>
        </div>
      </div>

      {user.data && (
        <ProfileEditModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          user={user.data}
        />
      )}
    </div>
  );
}

/**
 * Renders the row of social slot icons (github / twitter / website lucide
 * icons, and a custom "B站" pill for bilibili since lucide has no icon).
 * Hidden when no slot is set.
 */
function SocialRow({
  links,
}: {
  links: {
    github?: string;
    twitter?: string;
    bilibili?: string;
    website?: string;
  } | null;
}) {
  if (!links) return null;
  const entries: Array<{ key: string; href: string; node: React.ReactNode }> = [];
  if (links.github)
    entries.push({
      key: "github",
      href: links.github,
      node: <Github size={16} />,
    });
  if (links.twitter)
    entries.push({
      key: "twitter",
      href: links.twitter,
      node: <Twitter size={16} />,
    });
  if (links.bilibili)
    entries.push({
      key: "bilibili",
      href: links.bilibili,
      node: <span className="px-1 text-[10px] font-bold leading-none">B站</span>,
    });
  if (links.website)
    entries.push({
      key: "website",
      href: links.website,
      node: <Globe size={16} />,
    });
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {entries.map((e) => (
        <li key={e.key}>
          <a
            href={e.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={e.key}
            className="inline-flex h-7 min-w-7 items-center justify-center rounded-pill border border-border-soft bg-surface px-2 text-ink hover:bg-panel-2"
          >
            {e.node}
          </a>
        </li>
      ))}
    </ul>
  );
}
