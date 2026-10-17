import { checkAdminAccess } from "@/lib/admin/access";
import { computeDueSlot, computeNextRun, coerceScheduleConfig } from "@/lib/agent/schedule";
import { claimSlot, readScheduleRecord, recordRunResult } from "@/lib/agent/schedule-store";
import { isScheduledRunInProgress, runScheduledPass } from "@/lib/agent/scheduled-run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Scheduled passes analyze sequentially; keep the function alive long enough on
// serverless hosts. Free Vercel functions cap this at 60s — the external cron
// simply retries the next slot-free tick if a run is cut short.
export const maxDuration = 60;

/**
 * POST /api/agent/scheduler/tick
 *
 * Called by the external cron (GitHub Actions, every 5 minutes). It is a cheap
 * no-op until a configured local time slot is due; then it runs exactly one
 * "fetch → analyze → send" pass.
 *
 * Safety:
 *  - the exact slot (`YYYY-MM-DDTHH:MM` local) is claimed atomically before the
 *    pass, so overlapping ticks / restarts can never send twice;
 *  - a late cron still fires within SCHEDULE_GRACE_MINUTES of the slot;
 *  - requires admin access when ADMIN_ACCESS_KEY is configured (the workflow
 *    sends it as `x-admin-key`).
 */
export async function POST(request: Request) {
  const access = checkAdminAccess(request);
  if (!access.authorized) {
    return Response.json({ success: false, message: access.reason }, { status: 401 });
  }

  const record = await readScheduleRecord();
  const config = coerceScheduleConfig(record);
  const now = new Date();

  const due = computeDueSlot({ now, config, lastRunSlot: record.lastRunSlot });

  if (!due.due) {
    const next = computeNextRun({ now, config });
    return Response.json({
      success: true,
      ran: false,
      reason: due.reason,
      nextRunAt: next?.at.toISOString() ?? null,
      nextRunSlot: next?.slotKey ?? null,
      message:
        due.reason === "disabled"
          ? "زمان‌بندی خودکار خاموش است."
          : due.reason === "already_ran"
            ? "این نوبت قبلاً اجرا شده است."
            : "هنوز زمان اجرای نوبت نرسیده است.",
    });
  }

  if (isScheduledRunInProgress()) {
    return Response.json({
      success: true,
      ran: false,
      reason: "in_progress",
      slotKey: due.slotKey,
      message: "یک اجرا در حال انجام است.",
    });
  }

  const claimed = await claimSlot(record.id, due.slotKey);
  if (!claimed) {
    return Response.json({
      success: true,
      ran: false,
      reason: "already_claimed",
      slotKey: due.slotKey,
      message: "این نوبت توسط درخواست دیگری آغاز شده است.",
    });
  }

  const summary = await runScheduledPass({ config, trigger: "schedule", slotKey: due.slotKey });
  await recordRunResult(record.id, summary);

  console.log(
    `[scheduler] slot ${due.slotKey} finished: fetch=${summary.ingest?.created ?? 0} analyzed=${summary.analysis?.analyzed ?? 0} sent=${summary.send?.sent ?? 0} errors=${summary.errors.length}`,
  );

  return Response.json({
    success: true,
    ran: true,
    slotKey: due.slotKey,
    nextRunAt: computeNextRun({ now: new Date(), config })?.at.toISOString() ?? null,
    summary,
  });
}
