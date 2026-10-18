/**
 * Entity dossiers (roadmap Phase 3, task #7) — SERVER-SIDE ONLY.
 *
 * GET /api/admin/entities
 *   → list of extracted entities with counts/averages (bounded recent scan).
 * GET /api/admin/entities?name=<entity>
 *   → one dossier: stats + the news mentioning it (newest first).
 *
 * Aggregation happens in JS over the most recent analyzed rows — the corpus
 * per deployment is small (a focused domain), and this avoids vendor-specific
 * jsonb SQL while staying bounded (<= 1000 rows scanned).
 */

import { checkAdminAccess } from "@/lib/admin/access";
import { dbErrorResponse } from "@/lib/admin/db-error-response";
import { diagnoseDbError } from "@/lib/admin/db-errors";
import { db } from "@/db";
import { news } from "@/db/schema";
import { desc, isNotNull } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCAN_LIMIT = 1000;

type EntitySummary = {
  name: string;
  count: number;
  avgImportance: number;
  corroboratedCount: number;
  lastPublishedAt: string | null;
};

export async function GET(request: Request) {
  const access = checkAdminAccess(request);
  if (!access.authorized) {
    return Response.json({ success: false, message: access.reason }, { status: 401 });
  }

  const name = new URL(request.url).searchParams.get("name")?.trim() || "";

  try {
    const rows = await db
      .select({
        id: news.id,
        title: news.title,
        summary: news.summary,
        url: news.url,
        source: news.source,
        category: news.category,
        importanceScore: news.importanceScore,
        relevanceScore: news.relevanceScore,
        publishedAt: news.publishedAt,
        createdAt: news.createdAt,
        analyzedAt: news.analyzedAt,
        entityTags: news.entityTags,
        corroborationCount: news.corroborationCount,
        relevanceGrade: news.relevanceGrade,
      })
      .from(news)
      .where(isNotNull(news.analyzedAt))
      .orderBy(desc(news.createdAt))
      .limit(SCAN_LIMIT);

    if (!name) {
      const summaries = new Map<string, EntitySummary>();
      for (const row of rows) {
        for (const entity of row.entityTags ?? []) {
          const key = entity.trim();
          if (!key) continue;
          const current = summaries.get(key) ?? {
            name: key,
            count: 0,
            avgImportance: 0,
            corroboratedCount: 0,
            lastPublishedAt: null,
          };
          current.count += 1;
          current.avgImportance += row.importanceScore ?? 0;
          if ((row.corroborationCount ?? 0) >= 2) current.corroboratedCount += 1;
          const when = (row.publishedAt ?? row.createdAt)?.toISOString() ?? null;
          if (when && (!current.lastPublishedAt || when > current.lastPublishedAt)) {
            current.lastPublishedAt = when;
          }
          summaries.set(key, current);
        }
      }

      const list = [...summaries.values()]
        .map((entry) => ({
          ...entry,
          avgImportance: entry.count > 0 ? Math.round(entry.avgImportance / entry.count) : 0,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 200);

      return Response.json({ success: true, entities: list, scanned: rows.length });
    }

    const matched = rows
      .filter((row) => (row.entityTags ?? []).some((entity) => entity.trim() === name))
      .sort((a, b) => {
        const aTime = (a.publishedAt ?? a.createdAt)?.getTime() ?? 0;
        const bTime = (b.publishedAt ?? b.createdAt)?.getTime() ?? 0;
        return bTime - aTime;
      })
      .slice(0, 50);

    const stats = {
      name,
      count: matched.length,
      avgImportance:
        matched.length > 0
          ? Math.round(matched.reduce((sum, row) => sum + (row.importanceScore ?? 0), 0) / matched.length)
          : 0,
      corroboratedCount: matched.filter((row) => (row.corroborationCount ?? 0) >= 2).length,
      lastPublishedAt: matched[0]
        ? (matched[0].publishedAt ?? matched[0].createdAt)?.toISOString() ?? null
        : null,
    };

    return Response.json({
      success: true,
      stats,
      news: matched.map((row) => ({
        id: row.id,
        title: row.title,
        summary: row.summary,
        url: row.url,
        source: row.source,
        category: row.category,
        importanceScore: row.importanceScore,
        relevanceScore: row.relevanceScore,
        corroborationCount: row.corroborationCount,
        relevanceGrade: row.relevanceGrade,
        publishedAt: (row.publishedAt ?? row.createdAt)?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    return dbErrorResponse(error, "خواندن پروندهٔ موجودیت‌ها ناموفق بود.");
  }
}

export { diagnoseDbError };
