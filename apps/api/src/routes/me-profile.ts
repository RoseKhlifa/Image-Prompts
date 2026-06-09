import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyAuth } from "@hono/auth-js";
import { z } from "zod";
import { zv } from "../lib/validate.ts";
import { requireUserId } from "../middleware/auth.ts";
import { banCheck } from "../middleware/ban-check.ts";
import { recordAudit } from "../repositories/audit.ts";
import {
  PromptNotOwnedError,
  setMyPinnedPrompts,
  updateMyProfile,
  type UpdateMyProfilePatch,
} from "../repositories/me-profile.ts";

const app = new Hono();

// Every /api/me/profile/* handler requires an authenticated, unbanned user.
// banCheck() returns 403 `banned` if the signed-in user is banned.
app.use("*", verifyAuth(), banCheck());

// ── PATCH / — update bio + social links ─────────────────────────────────
//
// Bio is bilingual `{ zh?, en? }` — both sides optional (max 500 chars each).
// Social links are 4 fixed slots, each independently optional, each validated
// as a URL (max 400 chars). The "URL valid" check uses zod's stock
// `z.string().url()` — when it fails, we surface the slot key in the error
// message so the modal can highlight the bad input.
//
// Repo-layer semantics: an empty string on a side/slot DROPS that side/slot.
// Sending `{ socialLinks: { github: "" } }` clears the github URL but
// preserves twitter/bilibili/website. This matches the announcements polish
// pattern from M10b — the route layer strips `undefined`s; the repo merges
// the patch against the current row.
const BioSchema = z.object({
  zh: z.string().max(500).optional(),
  en: z.string().max(500).optional(),
});

// Each slot is validated as a URL OR an empty string (clear-this-slot).
// We use z.union so the modal can clear a slot by sending "" — that's
// strictly an empty string, not a URL, so the bare `.url()` would reject.
function slotSchema(slot: string) {
  return z
    .string()
    .max(400)
    .refine(
      (v) => v.length === 0 || isLikelyUrl(v),
      { message: `invalid_url:${slot}` },
    )
    .optional();
}

function isLikelyUrl(v: string): boolean {
  // Match zod's URL semantics without paying the import cost — we accept the
  // same things `z.string().url()` does (scheme + host). Anything that's not
  // a URL gets rejected with `invalid_url:<slot>` so the modal can highlight.
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const SocialLinksSchema = z.object({
  github: slotSchema("github"),
  twitter: slotSchema("twitter"),
  bilibili: slotSchema("bilibili"),
  website: slotSchema("website"),
});

const UpdateProfileSchema = z.object({
  bio: BioSchema.optional(),
  socialLinks: SocialLinksSchema.optional(),
});

app.patch(
  "/",
  zv("json", UpdateProfileSchema),
  async (c) => {
    const userId = requireUserId(c);
    const input = c.req.valid("json");
    // exactOptionalPropertyTypes: zod `.optional()` emits `T | undefined` but
    // UpdateMyProfilePatch's `?:` rejects literal `undefined` on the outer
    // keys. Build the patch by including only keys the caller actually sent.
    const patch: UpdateMyProfilePatch = {};
    if (input.bio !== undefined) patch.bio = input.bio;
    if (input.socialLinks !== undefined) patch.socialLinks = input.socialLinks;
    const updated = await updateMyProfile(userId, patch);
    await recordAudit({
      actorId: userId,
      action: "profile.update",
      targetType: "user",
      targetId: userId,
      payload: {
        // Don't dump the actual content — the bio could be long. Record
        // *which* fields were changed for audit traceability.
        fields: Object.keys(input),
      },
    });
    return c.json(updated);
  },
);

// ── PUT /pins — replace pinned prompt set ──────────────────────────────
//
// Body: { promptIds: string[] }, length 0–3. Pinned set is REPLACED, not
// merged: an empty array clears every pin. Each id must be a UUID AND
// belong to a prompt this user contributed; foreign ownership maps to 400
// `not_owned:<id>`. The repo de-dupes preserving first-seen order.
const SetPinsSchema = z.object({
  promptIds: z.array(z.string().uuid()).max(3),
});

app.put(
  "/pins",
  zv("json", SetPinsSchema),
  async (c) => {
    const userId = requireUserId(c);
    const { promptIds } = c.req.valid("json");
    try {
      const pinned = await setMyPinnedPrompts(userId, promptIds);
      await recordAudit({
        actorId: userId,
        action: "profile.update_pins",
        targetType: "user",
        targetId: userId,
        payload: { promptIds },
      });
      return c.json({ pinnedPrompts: pinned });
    } catch (e) {
      if (e instanceof PromptNotOwnedError) {
        throw new HTTPException(400, { message: `not_owned:${e.promptId}` });
      }
      throw e;
    }
  },
);

export default app;
