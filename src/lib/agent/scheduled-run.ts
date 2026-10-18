/**
 * Scheduled automatic publishing — the full pass (SERVER-SIDE ONLY).
 *
 *   fetch due feeds → analyze pending articles → send matching ones (Bale)
 *
 * Triggered by the external scheduler (`POST /api/agent/scheduler/tick`, called
 * by GitHub Actions every few minutes) only when a configured local time slot
 * is due, or manually from the dashboard. The pass is idempotent at the
 * delivery layer: `sendNewsDelivery` refuses to send an article twice to the
 * same destination, and `lastRunSlot` prevents the same slot from running again.
 */

import { db } from "@/db";
import { agentSchedules, deliveries, news } from "@/db/schema";
import { readActiveOperationalSettings } from "@/lib/ai/config-service";
import { diagnoseDbError } from "@/lib/admin/db-errors";
import { expandTargets } from "@/lib/delivery/types";
import {
  analyzeSequentially,
  applyTopicGate,
  recoverStaleProcessing,
  selectAnalysisBacklog,
} from "@/lib/news/analysis-queue";
import { deriveGapQueries, buildSearchUrl, MAX_GAP_QUERIES } from "@/lib/news/gap-search";
import { fetchFeed, type NormalizedNews } from "@/lib/news/rss";
import { ingestAllActiveSources, ingestSearchItems } from "@/lib/news/source-ingest";
import { and, asc, desc, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import { runAutoDeliveryPass } from "./index";
import type { AutoSendRule } from "./rules";
import type {
  AgentRunSummary,
  AgentScheduleConfig,
  ScheduleAnalysisSummary,
  ScheduleGapSummary,
  ScheduleIngestSummary,
  ScheduleSendSummary,
} from "./schedule";
import { markGapSearchRun } from "./schedule-store";

/** Root-cause-first, secret-free text (drizzle hides the real error in `cause`). */
function errorText(error: unknown): string {
  return diagnoseDbError(error).detail.slice(0, 300);
}

/** The schedule's own policy — independent from the post-analysis auto-send rule. */
export function scheduleToRule(config: AgentScheduleConfig): AutoSendRule {
  return {
    enabled: true,
    destination: config.destination,
    minImportance: config.minImportance,
    minRelevance: config.minRelevance,
    minNovelty: config.minNovelty,
    requireAiRecommendation: config.requireAiRecommendation,
    categories: null,
    maxItemsPerPass: config.maxSend,
  };
}

/**
 * Analyzed articles that were never successfully sent to this pass's
 * destination(s), newest first. Already-delivered articles are excluded at the
 * SQL level so the batch is not wasted re-checking them.
 */
export async function selectSendCandidates(
  config: Pick<AgentScheduleConfig, "destination" | "maxSend">,
): Promise<string[]> {
  const targets = expandTargets(config.destination);

  const rows = await db
    .select({ id: news.id })
    .from(news)
    .where(
      and(
        isNotNull(news.analyzedAt),
        sql`coalesce(${news.summary}, '') <> ''`,
        sql`${news.status} NOT IN ('DUPLICATE', 'SKIPPED_OFFTOPIC')`,
        notExists(
          db
            .select({ one: sql`1` })
            .from(deliveries)
            .where(
              and(
                eq(deliveries.newsId, news.id),
                eq(deliveries.status, "sent"),
                inArray(deliveries.destination, targets),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(sql`coalesce(${news.publishedAt}, ${news.createdAt})`))
    .limit(config.maxSend);

  return rows.map((row) => row.id);
}

/** Gap-search runs at most this often (the operator's target cadence is ~30min). */
const GAP_SEARCH_COOLDOWN_MS = 3 * 60 * 60 * 1000;

/** Upper bound of gap items stored/analyzed per run. */
const GAP_SEARCH_MAX_ITEMS = 5;

/**
 * Coverage-gap search phase (roadmap Phase 1 #2). Runs ONLY when the pass sent
 * nothing, so it can never crowd out real coverage. Best-effort by design:
 * failures are summarized, never thrown at the pass.
 */
async function runGapSearchPhase(
  config: AgentScheduleConfig,
  alreadySent: number,
): Promise<ScheduleGapSummary> {
  const base: ScheduleGapSummary = {
    ran: false,
    reason: null,
    queries: [],
    found: 0,
    analyzed: 0,
    sent: 0,
  };

  if (alreadySent > 0) return { ...base, reason: "already_sent" };

  try {
    // Cooldown against the singleton row, so back-to-back manual runs don't
    // hammer the search provider.
    const [row] = await db
      .select({ at: agentSchedules.lastGapSearchAt })
      .from(agentSchedules)
      .orderBy(asc(agentSchedules.createdAt))
      .limit(1);
    const lastAt = row?.at ? new Date(row.at).getTime() : 0;
    if (lastAt > 0 && Date.now() - lastAt < GAP_SEARCH_COOLDOWN_MS) {
      return { ...base, reason: "cooldown" };
    }

    const settings = await readActiveOperationalSettings();
    const coverageKeywords =
      settings?.topicFilter?.topics
        ?.filter((topic) => topic.enabled)
        .flatMap((topic) => topic.keywords) ?? [];
    const queries = deriveGapQueries(coverageKeywords, config.gapSearchQueries, MAX_GAP_QUERIES);
    if (queries.length === 0) return { ...base, reason: "no_queries" };

    const template = process.env.NEWS_SEARCH_URL_TEMPLATE?.trim() || null;
    const collected: NormalizedNews[] = [];
    let successfulFetches = 0;

    for (const query of queries) {
      try {
        const result = await fetchFeed(buildSearchUrl(query, template));
        if (result.ok) {
          successfulFetches += 1;
          collected.push(...result.items);
        }
      } catch {
        // One broken provider response must not stop the other queries.
      }
    }

    if (successfulFetches === 0) {
      await markGapSearchRun();
      return { ...base, reason: "all_fetches_failed", queries };
    }

    const limited = collected.slice(0, GAP_SEARCH_MAX_ITEMS);
    const report = await ingestSearchItems(limited, "جست‌وجوی هدفمند");

    let analyzed = 0;
    let sent = 0;
    if (report.newArticleIds.length > 0) {
      // The topic gate already ran at store time; analyze only the fresh gap
      // items, then deliver with the SAME strict rule as the scheduled pass.
      const results = await analyzeSequentially(report.newArticleIds.slice(0, GAP_SEARCH_MAX_ITEMS));
      analyzed = results.filter((item) => item.ok).length;

      const candidates = await selectSendCandidates(config);
      const gapCandidates = candidates.filter((id) => report.newArticleIds.includes(id));
      if (gapCandidates.length > 0) {
        const delivery = await runAutoDeliveryPass({
          newsIds: gapCandidates,
          rule: scheduleToRule(config),
        });
        sent = delivery.sent;
      }
    }

    await markGapSearchRun();
    return {
      ran: true,
      reason: null,
      queries,
      found: report.itemsFound,
      analyzed,
      sent,
    };
  } catch (error) {
    return { ...base, reason: "all_fetches_failed", detail: errorText(error) };
  }
}

let activeRun = false;

/** True while a pass is running in this server instance (overlap guard). */
export function isScheduledRunInProgress(): boolean {
  return activeRun;
}

/** Fetch → analyze → send. Never throws; every failure lands in `errors`. */
export async function runScheduledPass(args: {
  config: AgentScheduleConfig;
  trigger: "schedule" | "manual";
  slotKey?: string | null;
}): Promise<AgentRunSummary> {
  activeRun = true;
  try {
    return await executeScheduledPass(args);
  } finally {
    activeRun = false;
  }
}

async function executeScheduledPass(args: {
  config: AgentScheduleConfig;
  trigger: "schedule" | "manual";
  slotKey?: string | null;
}): Promise<AgentRunSummary> {
  const startedAt = new Date();
  const errors: string[] = [];

  let ingest: ScheduleIngestSummary | null = null;
  let analysis: ScheduleAnalysisSummary | null = null;
  let send: ScheduleSendSummary | null = null;

  // 1) Fetch every active source (scheduled runs ignore per-source intervals:
  //    the digest must contain everything available right now).
  try {
    const result = await ingestAllActiveSources();
    if (result.ok) {
      ingest = {
        attempted: true,
        sources: result.bySource?.length ?? 1,
        created: result.stored,
        duplicates: result.duplicates,
        failed: 0,
      };
    } else {
      ingest = { attempted: true, sources: 0, created: 0, duplicates: 0, failed: 1, detail: result.message };
      errors.push(`دریافت اخبار: ${result.message}`);
    }
  } catch (error) {
    const detail = errorText(error);
    ingest = { attempted: true, sources: 0, created: 0, duplicates: 0, failed: 1, detail };
    errors.push(`دریافت اخبار: ${detail}`);
  }

  // 2) Analyze the pending backlog (oldest first, bounded per run).
  try {
    await recoverStaleProcessing();

    const selected = await selectAnalysisBacklog(args.config.maxAnalyze);
    const gated = await applyTopicGate(selected);
    const results = await analyzeSequentially(gated.pass);

    const failedAnalyses = results.filter((item) => !item.ok);

    analysis = {
      selected: selected.length,
      analyzed: results.filter((item) => item.ok).length,
      failed: failedAnalyses.length,
      skippedOfftopic: gated.skipped.length,
    };

    // Without this, a missing AI key only shows up as "0 analyzed / N failed"
    // and the dashboard cannot tell the operator why nothing was sent.
    if (failedAnalyses.length > 0) {
      const first = failedAnalyses[0];
      const reason = first.message ?? first.code ?? "ناموفق";
      const rest = failedAnalyses.length > 1 ? ` (و ${failedAnalyses.length - 1} مورد دیگر)` : "";
      errors.push(`تحلیل خبر: ${reason}${rest}`);
    }
  } catch (error) {
    const detail = errorText(error);
    analysis = { selected: 0, analyzed: 0, failed: 0, skippedOfftopic: 0 };
    errors.push(`تحلیل اخبار: ${detail}`);
  }

  // 3) Send everything analyzed and not yet delivered to this destination.
  try {
    const candidates = await selectSendCandidates(args.config);
    const result = await runAutoDeliveryPass({
      newsIds: candidates,
      rule: scheduleToRule(args.config),
    });

    send = {
      enabled: result.enabled,
      destination: result.destination,
      considered: result.considered,
      matched: result.matched,
      sent: result.sent,
      skippedDuplicates: result.skippedDuplicates,
      skippedReview: result.skippedReview,
      failed: result.failed,
      // Keep a few rejected candidates with their reasons so the operator can
      // see WHY a news item was not sent instead of guessing at the thresholds.
      rejected: result.items
        .filter((item) => item.outcome === "not_matched" || item.outcome === "skipped_review")
        .slice(0, 5)
        .map((item) => ({ title: item.title, reasons: item.reasons ?? [] })),
    };

    for (const item of result.items) {
      if (item.outcome === "failed" && item.errors?.length) {
        errors.push(`${item.title}: ${item.errors.join(" | ")}`);
      }
    }
  } catch (error) {
    const detail = errorText(error);
    send = {
      enabled: true,
      destination: args.config.destination,
      considered: 0,
      matched: 0,
      sent: 0,
      skippedDuplicates: 0,
      skippedReview: 0,
      failed: 0,
    };
    errors.push(`ارسال خودکار: ${detail}`);
  }

  // 4) Coverage-gap search — only when this pass sent nothing and the feature
  //    is enabled. Feeds its results through the same analyze + strict send.
  let gapSearch: ScheduleGapSummary | null = null;
  if (args.config.gapSearchEnabled) {
    try {
      gapSearch = await runGapSearchPhase(args.config, send.sent);
    } catch (error) {
      gapSearch = {
        ran: false,
        reason: "all_fetches_failed",
        queries: [],
        found: 0,
        analyzed: 0,
        sent: 0,
      };
      errors.push(`جست‌وجوی هدفمند: ${errorText(error)}`);
    }
  }

  const finishedAt = new Date();

  return {
    ok: errors.length === 0,
    trigger: args.trigger,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    slotKey: args.slotKey ?? null,
    ingest,
    analysis,
    send,
    gapSearch,
    errors: errors.slice(0, 10),
  };
}
