import { db } from "@/db";
import { news } from "@/db/schema";
import { readActiveOperationalSettings } from "@/lib/ai/config-service";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { checkAdminAccess } from "@/lib/admin/access";
import { maybeRunAutoSend } from "@/lib/agent/auto-hook";
import { analyzeArticle } from "@/lib/news/analyze";
import { ingestNews } from "@/lib/news/ingest";
import { evaluateTopicFilter } from "@/lib/news/topic-filter";

export const dynamic = "force-dynamic";

const MAX_AI_ITEMS_PER_RUN = 4;
const STALE_PROCESSING_MINUTES = 15;

/**
 * Last gate before the expensive AI stage: applies the configured topic filter
 * to the selected backlog rows. Non-matching rows are marked SKIPPED_OFFTOPIC
 * (still stored, re-queueable later) and excluded from this run's AI calls.
 * Fails open — when the filter is inactive, everything passes unchanged.
 */
async function applyTopicGate(selectedIds: string[]): Promise<{ pass: string[]; skipped: string[] }> {
  if (selectedIds.length === 0) return { pass: [], skipped: [] };

  const settings = await readActiveOperationalSettings();
  const filter = settings?.topicFilter ?? null;
  const outcome = evaluateTopicFilter({ title: "" }, filter);
  if (outcome.reason === "filter_disabled" || outcome.reason === "no_effective_topics") {
    return { pass: selectedIds, skipped: [] };
  }

  const rows = await db
    .select({
      id: news.id,
      title: news.title,
      description: news.description,
      content: news.content,
    })
    .from(news)
    .where(inArray(news.id, selectedIds));

  const pass: string[] = [];
  const skipped: string[] = [];
  const skippedIds: string[] = [];
  for (const row of rows) {
    const result = evaluateTopicFilter(row, filter);
    if (result.verdict === "pass") pass.push(row.id);
    else {
      skipped.push(row.id);
      skippedIds.push(row.id);
    }
  }

  if (skippedIds.length > 0) {
    await db
      .update(news)
      .set({ status: "SKIPPED_OFFTOPIC", updatedAt: new Date() })
      .where(inArray(news.id, skippedIds));
  }

  return { pass, skipped };
}

/**
 * POST /api/news/fetch
 *
 * Pipeline:
 * 1. Ingest all active sources.
 * 2. Recover stale AI_PROCESSING items.
 * 3. Process only a small sequential batch of READY_FOR_AI items.
 * 4. Evaluate auto-send only for items analyzed in this run.
 *
 * Ingestion is intentionally not limited: all newly fetched articles are
 * stored and remain in READY_FOR_AI until a later scheduled run processes them.
 */
export async function POST(request: Request) {
  const access = checkAdminAccess(request);

  if (!access.authorized) {
    return Response.json(
      {
        success: false,
        code: "unauthorized",
        message: access.reason,
      },
      { status: 401 },
    );
  }
  try {
    const result = await ingestNews();

    if (!result.ok) {
      return Response.json({
        success: false,
        code: result.code,
        message: result.message,
        detail: result.detail ?? null,
      });
    }

    // Recover articles that were left in AI_PROCESSING by an interrupted
    // request or server restart.
    const staleBefore = new Date(
      Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000,
    );

    await db
      .update(news)
      .set({
        status: "READY_FOR_AI",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(news.status, "AI_PROCESSING"),
          lt(news.updatedAt, staleBefore),
        ),
      );

    // Prefer articles fetched in this run, then continue with older backlog.
    const selectedIds: string[] = [];

    for (const id of result.newArticleIds) {
      if (selectedIds.length >= MAX_AI_ITEMS_PER_RUN) break;
      selectedIds.push(id);
    }

    if (selectedIds.length < MAX_AI_ITEMS_PER_RUN) {
      const remaining = MAX_AI_ITEMS_PER_RUN - selectedIds.length;

      const backlog = await db
        .select({ id: news.id })
        .from(news)
        .where(
          and(
            eq(news.status, "READY_FOR_AI"),
            selectedIds.length > 0
              ? sql`${news.id} NOT IN (${sql.join(
                  selectedIds.map((id) => sql`${id}::uuid`),
                  sql`, `,
                )})`
              : sql`TRUE`,
          ),
        )
        .orderBy(sql`coalesce(${news.publishedAt}, ${news.createdAt}) ASC`)
        .limit(remaining);

      selectedIds.push(...backlog.map((row) => row.id));
    }

    // Topic relevance gate BEFORE AI — off-topic items never reach the model.
    const gated = await applyTopicGate(selectedIds);
    const aiQueue = gated.pass;

    const analysisResults = [];

    // IMPORTANT: keep AI calls sequential. This is intentional because the
    // provider has a low TPM limit.
    for (const id of aiQueue) {
      try {
        const analysis = await analyzeArticle(id);

        analysisResults.push({
          id,
          ok: analysis.ok,
          code: analysis.ok ? null : analysis.code,
          message: analysis.ok ? null : analysis.message,
          detail: analysis.ok ? null : (analysis.detail ?? null),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);

        console.error(
          "[news-fetch] article analysis failed:",
          detail.slice(0, 200),
        );

        analysisResults.push({
          id,
          ok: false,
          code: "analysis_error",
          message: detail,
          detail: null,
        });
      }
    }

    // Auto-send only articles that were actually analyzed during this run.
    const analyzedIds = analysisResults
      .filter((item) => item.ok)
      .map((item) => item.id);

    const autoSend =
      analyzedIds.length > 0
        ? await maybeRunAutoSend(analyzedIds)
        : {
            ok: true,
            sent: 0,
            skipped: 0,
            reason: "No articles were successfully analyzed in this run.",
          };

    return Response.json({
      success: true,
      source: result.source,
      fetched: result.fetched,
      stored: result.stored,
      newArticleIds: result.newArticleIds,
      queuedForAnalysis: aiQueue,
      topicSkipped: gated.skipped,
      analyzed: analysisResults,
      duplicates: result.duplicates,
      skipped: result.skipped,
      filtered: result.filtered,
      autoSend,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    console.error(
      "[news-fetch] unexpected error:",
      detail.slice(0, 200),
    );

    return Response.json(
      {
        success: false,
        code: "unknown_error",
        message: "Unexpected error while fetching news.",
        detail: null,
      },
      { status: 500 },
    );
  }
}
