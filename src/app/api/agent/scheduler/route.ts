import { checkAdminAccess } from "@/lib/admin/access";
import { getBaleConfigStatus } from "@/lib/bale/client";
import {
  computeDueSlot,
  computeNextRun,
  coerceScheduleConfig,
  describeSchedule,
  validateScheduleInput,
  type AgentScheduleConfig,
} from "@/lib/agent/schedule";
import { readScheduleRecord, recordRunResult, saveScheduleConfig } from "@/lib/agent/schedule-store";
import { isScheduledRunInProgress, runScheduledPass } from "@/lib/agent/scheduled-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function nextRunInfo(config: AgentScheduleConfig) {
  const next = computeNextRun({ now: new Date(), config });
  return next
    ? {
        nextRunAt: next.at.toISOString(),
        nextRunSlot: next.slotKey,
        nextRunTime: next.time,
      }
    : { nextRunAt: null, nextRunSlot: null, nextRunTime: null };
}

/**
 * GET /api/agent/scheduler
 *
 * Current schedule + derived status for the dashboard. Read-only and exposes
 * no credentials (Bale readiness is a boolean + missing variable names).
 */
export async function GET() {
  const record = await readScheduleRecord();
  const bale = getBaleConfigStatus();
  const due = computeDueSlot({ now: new Date(), config: record, lastRunSlot: record.lastRunSlot });
  const next = nextRunInfo(record);

  return Response.json({
    success: true,
    config: {
      enabled: record.enabled,
      timezone: record.timezone,
      times: record.times,
      destination: record.destination,
      minImportance: record.minImportance,
      minRelevance: record.minRelevance,
      minNovelty: record.minNovelty,
      requireAiRecommendation: record.requireAiRecommendation,
      maxAnalyze: record.maxAnalyze,
      maxSend: record.maxSend,
    },
    status: {
      persisted: Boolean(record.id),
      enabled: record.enabled,
      nextRunAt: next.nextRunAt,
      nextRunSlot: next.nextRunSlot,
      lastRunAt: record.lastRunAt ? record.lastRunAt.toISOString() : null,
      lastRunSlot: record.lastRunSlot,
      lastResult: record.lastResult,
      dueReason: due.due ? "due" : due.reason,
      running: isScheduledRunInProgress(),
    },
    destinationsReady: { local: true, bale: bale.configured },
    baleMissing: bale.missing,
    description: describeSchedule(record),
  });
}

/**
 * PUT /api/agent/scheduler — save the schedule.
 * Requires admin access (cookie from the login popup, x-admin-key header, or
 * ?key= when ADMIN_ACCESS_KEY is configured on the host).
 */
export async function PUT(request: Request) {
  const access = checkAdminAccess(request);
  if (!access.authorized) {
    return Response.json({ success: false, message: access.reason }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, message: "بدنه درخواست JSON معتبر نیست." }, { status: 400 });
  }

  const validation = validateScheduleInput(body);
  if (!validation.ok) {
    return Response.json(
      { success: false, message: "زمان‌بندی نامعتبر است.", errors: validation.errors },
      { status: 400 },
    );
  }

  try {
    const saved = await saveScheduleConfig(validation.config);
    const bale = getBaleConfigStatus();
    const next = nextRunInfo(saved);

    return Response.json({
      success: true,
      message: "زمان‌بندی ذخیره شد.",
      config: validation.config,
      status: {
        persisted: Boolean(saved.id),
        enabled: saved.enabled,
        nextRunAt: next.nextRunAt,
        nextRunSlot: next.nextRunSlot,
        lastRunAt: saved.lastRunAt ? saved.lastRunAt.toISOString() : null,
        lastRunSlot: saved.lastRunSlot,
        lastResult: saved.lastResult,
      },
      destinationsReady: { local: true, bale: bale.configured },
      baleMissing: bale.missing,
      description: describeSchedule(saved),
    });
  } catch (error) {
    console.error("[scheduler] save failed:", String(error).slice(0, 200));
    return Response.json(
      {
        success: false,
        message: "ذخیره زمان‌بندی ناموفق بود.",
        detail: String(error).slice(0, 200),
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/agent/scheduler — run the full pass right now (manual catch-up).
 * The schedule's own thresholds/destination are used; the daily slot is left
 * untouched so the next scheduled run still happens.
 */
export async function POST(request: Request) {
  const access = checkAdminAccess(request);
  if (!access.authorized) {
    return Response.json({ success: false, message: access.reason }, { status: 401 });
  }

  if (isScheduledRunInProgress()) {
    return Response.json(
      { success: false, message: "یک اجرای زمان‌بندی‌شده در حال انجام است؛ چند لحظه بعد دوباره تلاش کنید." },
      { status: 409 },
    );
  }

  const record = await readScheduleRecord();
  const config = coerceScheduleConfig(record);
  const summary = await runScheduledPass({ config, trigger: "manual", slotKey: null });

  await recordRunResult(record.id, summary);

  return Response.json({ success: true, summary });
}
