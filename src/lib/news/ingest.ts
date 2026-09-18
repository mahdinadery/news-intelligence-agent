/**
 * News ingestion service — SERVER-SIDE ONLY.
 *
 * Milestone 6 note: the fetch/parse/normalize/canonicalize/dedupe/store stages
 * now live in the shared pipeline (src/lib/news/source-ingest.ts). This module
 * keeps the legacy dashboard-facing functions with the exact same shapes as
 * before so /api/news/fetch and the existing UI keep working unchanged.
 *
 * Duplicate detection anchors (all preserved from earlier milestones):
 *   - exact `news.url` unique index (primary anchor, unchanged)
 *   - `canonicalUrl` and `externalId` (added by the pipeline, conservative)
 */

import { db } from "@/db";
import { news } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import { ingestAllActiveSources } from "./source-ingest";

export type IngestResult =
  | {
      ok: true;
      source: string;
      fetched: number;
      stored: number;
      duplicates: number;
      skipped: number;
    }
  | { ok: false; code: string; message: string; detail?: string | null };

/**
 * Dashboard "Fetch News" entry point. Now source-aware: fetches every ACTIVE
 * registered source (admin UI), falling back to the legacy env URL when no
 * source is registered yet. The response keeps the original single-source
 * shape (fetched/stored/duplicates are totals) so the existing card works.
 */
export async function ingestNews(): Promise<IngestResult> {
  const result = await ingestAllActiveSources();
  if (result.ok) {
    return {
      ok: true,
      source: result.source,
      fetched: result.fetched,
      stored: result.stored,
      duplicates: result.duplicates,
      skipped: result.skipped,
    };
  }
  return result;
}

export type NewsStats = {
  totalStored: number;
  lastFetchCount: number;
  lastFetchedAt: string | null;
  sources: number;
};

export async function getNewsStats(): Promise<NewsStats> {
  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      sources: sql<number>`count(distinct ${news.source})::int`,
    })
    .from(news)
    .where(sql`${news.status} <> 'DUPLICATE'`);

  // Timestamps are compared entirely inside SQL: Postgres stores microseconds
  // while a JS Date round-trip truncates to milliseconds, so filtering with
  // `eq(column, jsDate)` would silently match nothing.
  const [latestBatch] = await db
    .select({
      count: sql<number>`count(*)::int`,
      fetchedAt: sql<Date | null>`max(${news.fetchedAt})`,
    })
    .from(news)
    .where(sql`${news.fetchedAt} = (SELECT max(${news.fetchedAt}) FROM ${news})`);

  const lastFetchCount = latestBatch?.count ?? 0;
  const lastFetchedAt = latestBatch?.fetchedAt ? new Date(latestBatch.fetchedAt).toISOString() : null;

  return {
    totalStored: totals?.total ?? 0,
    lastFetchCount,
    lastFetchedAt,
    sources: totals?.sources ?? 0,
  };
}

export type NewsListItem = {
  id: string;
  title: string;
  url: string;
  source: string;
  description: string | null;
  publishedAt: string | null;

  // AI analysis fields (Milestone 4)
  summary: string | null;
  category: string | null;
  importanceScore: number | null;
  relevanceScore: number | null;
  noveltyScore: number | null;
  shouldSend: boolean | null;
  analysisReason: string | null;
  analyzedAt: string | null;
};

/** Public news list (user page). Duplicate-marked rows are excluded. */
export async function listLatestNews(limit = 60): Promise<NewsListItem[]> {
  const rows = await db
    .select({
      id: news.id,
      title: news.title,
      url: news.url,
      source: news.source,
      description: news.description,
      publishedAt: news.publishedAt,
      summary: news.summary,
      category: news.category,
      importanceScore: news.importanceScore,
      relevanceScore: news.relevanceScore,
      noveltyScore: news.noveltyScore,
      shouldSend: news.shouldSend,
      analysisReason: news.analysisReason,
      analyzedAt: news.analyzedAt,
    })
    .from(news)
    .where(sql`${news.status} <> 'DUPLICATE'`)
    .orderBy(desc(sql`coalesce(${news.publishedAt}, ${news.createdAt})`), desc(news.id))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    source: row.source,
    description: row.description,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    summary: row.summary,
    category: row.category,
    importanceScore: row.importanceScore,
    relevanceScore: row.relevanceScore,
    noveltyScore: row.noveltyScore,
    shouldSend: row.shouldSend,
    analysisReason: row.analysisReason,
    analyzedAt: row.analyzedAt ? row.analyzedAt.toISOString() : null,
  }));
}
