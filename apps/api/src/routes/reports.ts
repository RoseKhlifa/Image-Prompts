import { Hono } from "hono";
import { z } from "zod";
import { verifyAuth } from "@hono/auth-js";
import { requireUserId } from "../middleware/auth.ts";
import { banCheck } from "../middleware/ban-check.ts";
import { zv } from "../lib/validate.ts";
import { createReport, REPORT_REASONS } from "../repositories/reports.ts";
import { recordAudit } from "../repositories/audit.ts";

const CreateReportBody = z.object({
  targetType: z.literal("prompt"),
  targetId: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  detail: z.string().max(2000).optional(),
});

const app = new Hono();

/**
 * POST /api/reports — file a report. Auth required. Duplicate open reports
 * on the same target by the same reporter are coalesced (server returns
 * `deduped: true` plus the original id). Detail is optional free-form
 * text up to 2000 chars; reason is a fixed enum so the owner queue can
 * pivot on it.
 */
app.post(
  "/",
  verifyAuth(),
  banCheck(),
  zv("json", CreateReportBody),
  async (c) => {
    const userId = requireUserId(c);
    const body = c.req.valid("json");
    const result = await createReport({
      reporterId: userId,
      targetType: body.targetType,
      targetId: body.targetId,
      reason: body.reason,
      ...(body.detail ? { detail: body.detail } : {}),
    });
    if (!result.deduped) {
      await recordAudit({
        actorId: userId,
        action: "report.create",
        targetType: body.targetType,
        targetId: body.targetId,
        payload: { reason: body.reason, reportId: result.id },
      });
    }
    return c.json(result, result.deduped ? 200 : 201);
  },
);

export default app;
