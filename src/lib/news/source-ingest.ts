/**
 * Staged ingestion pipeline (Milestone 6).
 *
 *   fetch -> parse -> normalize -> canonicalize URL -> duplicate check -> store
 *
 * Each stage is a small function; the orchestrator never lets one malformed
 * item or one broken source abort another. Every attempt with a registered
 * source writes an `ingestion_runs` row and updates per-source health stats.
 *
 * Duplicate detection (conservative, no title heuristics):
 *   1. exact original URL (the pre-existing unique-index anchor), and
 *   2. canonical URL (tracking params removed), and
 *   3. upstream external id when both sides have one.
 * Canonical-only matches are STORED, marked DUPLICATE and linked to the
 * original — never silently discarded.
 */

import { db } from "@/db";
import { ingestionRuns, news, newsSources, type NewsSourceRow } from "@/db/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { canonicalizeUrl } from "./canonical-url";
import { normalizeContent, normalizeTitle } from "./normalize";
import { fetchFeed, parseFeed, type NewsFetchResult, type NormalizedNews } from "./rss";

const CHUNK_SIZE = 50;

export type PipelineReport = {
  ok: true;
  itemsFound: number;
  itemsCreated: number;
  duplicates: number;
  skippedMalformed: number;
  feedSourceName: string;
};

export type PipelineFailure = {
  ok: false;
  code: string;
  message: string;
  detail?: string | null;
};

type Candidate = {
  item: NormalizedNews;
  canonical: string;
};

/** Stage: parse + cap. Returns candidates newest-first. */
function toCandidates(parsed: NormalizedNews[], maxItems: number): Candidate[] {
  return parsed.slice(0, Math.max(1, maxItems)).map((item) => ({
    item,
    canonical: canonicalizeUrl(item.url),
  }));
}

/** Stage: dedupe within a single batch (same canonical URL twice in one feed). */
function dedupeWithinBatch(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.canonical)) continue;
    seen.add(candidate.canonical);
    unique.push(candidate);
  }
  return unique;
}

/** Stage: duplicate check against stored news (canonical URL + external id). */
async function findExistingMatches(
  candidates: Candidate[],
): Promise<{ byCanonical: Map<string, string>; byExternalId: Map<string, string> }> {
  const byCanonical = new Map<string, string>();
  const byExternalId = new Map<string, string>();

  const canonicals = candidates.map((candidate) => candidate.canonical).filter(Boolean);
  const externalIds = candidates.map((candidate) => candidate.item.externalId).filter((id): id is string => Boolean(id));

  for (let index = 0; index < canonicals.length; index += CHUNK_SIZE) {
    const rows = await db
      .select({ id: news.id, canonicalUrl: news.canonicalUrl })
      .from(news)
      .where(inArray(news.canonicalUrl, canonicals.slice(index, index + CHUNK_SIZE)));
    for (const row of rows) {
      if (row.canonicalUrl && !byCanonical.has(row.canonicalUrl)) {
        byCanonical.set(row.canonicalUrl, row.id);
      }
    }
  }

  for (let index = 0; index < externalIds.length; index += CHUNK_SIZE) {
    const rows = await db
      .select({ id: news.id, externalId: news.externalId })
      .from(news)
      .where(and(isNull(news.duplicateOfId), inArray(news.externalId, externalIds.slice(index, index + CHUNK_SIZE))));
    for (const row of rows) {
      if (row.externalId) byExternalId.set(row.externalId, row.id);
    }
  }

  return { byCanonical, byExternalId };
}

function buildValues(candidate: Candidate, source: NewsSourceRow | null, defaults: { sourceName: string }) {
  const { item, canonical } = candidate;
  return {
    sourceId: source?.id ?? null,
    source: source?.name ?? item.source ?? defaults.sourceName,
    externalId: item.externalId,
    title: item.title,
    url: item.url,
    canonicalUrl: canonical,
    publishedAt: item.publishedAt,
    description: item.description,
    content: item.content,
    author: item.author,
    imageUrl: item.imageUrl,
    normalizedTitle: normalizeTitle(item.title),
    normalizedContent: normalizeContent(item.content, item.description),
    fetchedAt: new Date(),
  };
}

/**
 * Stage: store. Inserts fresh items as READY_FOR_AI; inserts canonical
 * duplicates as marked DUPLICATE rows referencing the original (exact-URL
 * duplicates collide with the unique index and stay represented by the
 * original row).
 */
async function storeCandidates(
  fresh: Candidate[],
  duplicateRefs: Array<{ candidate: Candidate; originalId: string }>,
  source: NewsSourceRow | null,
  defaults: { sourceName: string },
): Promise<{ created: number; duplicateRowsStored: number }> {
  let created = 0;

  for (let index = 0; index < fresh.length; index += CHUNK_SIZE) {
    const chunk = fresh.slice(index, index + CHUNK_SIZE);
    const inserted = await db
      .insert(news)
      .values(
        chunk.map((candidate) => ({
          ...buildValues(candidate, source, defaults),
          status: "READY_FOR_AI",
        })),
      )
      .onConflictDoNothing({ target: news.url })
      .returning({ id: news.id });
    created += inserted.length;
  }

  let duplicateRowsStored = 0;
  if (duplicateRefs.length > 0) {
    for (let index = 0; index < duplicateRefs.length; index += CHUNK_SIZE) {
      const chunk = duplicateRefs.slice(index, index + CHUNK_SIZE);
      const inserted = await db
        .insert(news)
        .values(
          chunk.map(({ candidate, originalId }) => ({
            ...buildValues(candidate, source, defaults),
            status: "DUPLICATE",
            duplicateOfId: originalId,
          })),
        )
        .onConflictDoNothing({ target: news.url })
        .returning({ id: news.id });
      duplicateRowsStored += inserted.length;
    }
  }

  return { created, duplicateRowsStored };
}

/**
 * Full ingestion for one registered source, with run log + health updates.
 * Never throws; the returned report doubles as the "Fetch Now" result summary.
 */
export async function ingestFromSource(source: NewsSourceRow): Promise<PipelineReport | PipelineFailure> {
  const startedAt = new Date();

  if (source.type !== "rss") {
    return {
      ok: false,
      code: "type_not_supported",
      message: `نوع منبع «${source.type}» هنوز برای دریافت خودکار پیاده‌سازی نشده است (فقط RSS فعال است).`,
    };
  }

  const fetched = await fetchFeed(source.url);

  if (!fetched.ok) {
    await recordRun(source.id, startedAt, "failed", { itemsFound: 0, created: 0, duplicates: 0, skipped: 0 }, fetched.message, fetched.detail ?? null);
    await updateSourceAfterFailure(source.id, fetched.message);
    return { ok: false, code: fetched.code, message: fetched.message, detail: fetched.detail ?? null };
  }

  try {
    const candidates = dedupeWithinBatch(toCandidates(fetched.items, source.maxItemsPerFetch));
    const { byCanonical, byExternalId } = await findExistingMatches(candidates);

    const fresh: Candidate[] = [];
    const duplicateRefs: Array<{ candidate: Candidate; originalId: string }> = [];

    for (const candidate of candidates) {
      const matchByCanonical = byCanonical.get(candidate.canonical);
      const matchByExternal = candidate.item.externalId ? byExternalId.get(candidate.item.externalId) : undefined;
      const originalId = matchByCanonical ?? matchByExternal;

      if (originalId) {
        duplicateRefs.push({ candidate, originalId });
      } else {
        fresh.push(candidate);
      }
    }

    const { created, duplicateRowsStored } = await storeCandidates(fresh, duplicateRefs, source, {
      sourceName: fetched.source,
    });

    // Exact-URL collisions that onConflictDoNothing dropped count as duplicates too.
    const duplicates = candidates.length - created;
    const itemsFound = fetched.items.length;
    const runStatus = created === 0 && duplicates === 0 && itemsFound > 0 ? "partial" : "success";

    await recordRun(source.id, startedAt, runStatus, { itemsFound, created, duplicates, skipped: fetched.skipped }, null, null);
    await updateSourceAfterSuccess(source.id, itemsFound, created, duplicates);

    return {
      ok: true,
      itemsFound,
      itemsCreated: created,
      duplicates: Math.max(duplicates, 0),
      skippedMalformed: fetched.skipped,
      feedSourceName: fetched.source,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await recordRun(source.id, startedAt, "failed", { itemsFound: fetched.items.length, created: 0, duplicates: 0, skipped: fetched.skipped }, "خطا در ذخیره‌سازی اخبار", detail.slice(0, 500));
    await updateSourceAfterFailure(source.id, detail.slice(0, 300));
    return { ok: false, code: "db_error", message: "خطا در ذخیره‌سازی اخبار این منبع.", detail: detail.slice(0, 200) };
  }
}

/**
 * Legacy dashboard fetch (env `NEWS_SOURCE_RSS_URL`) routed through the same
 * pipeline core so URL/canonical dedupe is shared. Keeps its original report
 * shape; no run log / no source stats unless the URL matches a registered
 * source (in which case those are updated too).
 */
export async function ingestViaPipeline(): Promise<
  | { ok: true; source: string; fetched: number; stored: number; duplicates: number; skipped: number }
  | { ok: false; code: string; message: string; detail?: string | null }
> {
  const envUrl = process.env.NEWS_SOURCE_RSS_URL?.trim();
  if (!envUrl) {
    return { ok: false, code: "missing_url", message: "NEWS_SOURCE_RSS_URL is not configured.", detail: null };
  }

  // Prefer the registered source row when one points at the same URL, so
  // health/stats stay coherent no matter which button was pressed.
  const [matchingSource] = await db.select().from(newsSources).where(eq(newsSources.url, envUrl)).limit(1);

  const fetched = await fetchFeed(envUrl);
  if (!fetched.ok) {
    return { ok: false, code: fetched.code, message: fetched.message, detail: fetched.detail ?? null };
  }

  try {
    const candidates = dedupeWithinBatch(toCandidates(fetched.items, matchingSource?.maxItemsPerFetch ?? 50));
    const { byCanonical, byExternalId } = await findExistingMatches(candidates);

    const fresh: Candidate[] = [];
    const duplicateRefs: Array<{ candidate: Candidate; originalId: string }> = [];
    for (const candidate of candidates) {
      const originalId = byCanonical.get(candidate.canonical) ?? (candidate.item.externalId ? byExternalId.get(candidate.item.externalId) : undefined);
      if (originalId) duplicateRefs.push({ candidate, originalId });
      else fresh.push(candidate);
    }

    const { created } = await storeCandidates(fresh, duplicateRefs, matchingSource ?? null, { sourceName: fetched.source });
    const duplicates = Math.max(candidates.length - created, 0);

    if (matchingSource) {
      await recordRun(matchingSource.id, new Date(), "success", { itemsFound: fetched.items.length, created, duplicates, skipped: fetched.skipped }, null, null);
      await updateSourceAfterSuccess(matchingSource.id, fetched.items.length, created, duplicates);
    }

    return {
      ok: true,
      source: fetched.source,
      fetched: fetched.items.length,
      stored: created,
      duplicates,
      skipped: fetched.skipped,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, code: "db_error", message: "Could not store the fetched articles.", detail: detail.slice(0, 200) };
  }
}

/** Read-only feed probe for the admin "Test Source" action — stores NOTHING. */
export async function testFeedWithoutStoring(url: string, maxItems = 5): Promise<
  | { ok: true; feedTitle: string; itemCount: number; sample: Array<{ title: string; url: string; publishedAt: string | null }>; skipped: number }
  | { ok: false; message: string; detail?: string }
> {
  const fetched: NewsFetchResult = await fetchFeed(url);

  if (!fetched.ok) {
    return { ok: false, message: fetched.message, detail: fetched.detail };
  }

  return {
    ok: true,
    feedTitle: fetched.source,
    itemCount: fetched.items.length,
    skipped: fetched.skipped,
    sample: fetched.items.slice(0, Math.max(1, maxItems)).map((item) => ({
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
    })),
  };
}

/**
 * Aggregate ingestion used by the dashboard "Fetch News" button:
 * fetch EVERY active RSS source; if none is registered yet, fall back to the
 * legacy env source so nothing regresses. Keeps the single-source response
 * shape (totals) while the per-source detail rides along in `bySource`.
 */
export async function ingestAllActiveSources(): Promise<
  | {
      ok: true;
      source: string;
      fetched: number;
      stored: number;
      duplicates: number;
      skipped: number;
      bySource: Array<{ name: string; fetched: number; stored: number; duplicates: number }>;
    }
  | { ok: false; code: string; message: string; detail?: string | null }
> {
  const activeSources = await db
    .select()
    .from(newsSources)
    .where(and(eq(newsSources.active, true), eq(newsSources.type, "rss")));

  if (activeSources.length === 0) {
    const legacy = await ingestViaPipeline();
    return legacy.ok
      ? { ...legacy, ok: true as const, bySource: [{ name: legacy.source, fetched: legacy.fetched, stored: legacy.stored, duplicates: legacy.duplicates }] }
      : legacy;
  }

  let fetched = 0;
  let stored = 0;
  let duplicates = 0;
  let skipped = 0;
  let lastError: { code: string; message: string; detail?: string | null } | null = null;
  const bySource: Array<{ name: string; fetched: number; stored: number; duplicates: number }> = [];

  // Sources run CONCURRENTLY so one geo-blocked host (a slow timeout) cannot
  // add up across the sweep; the whole dashboard fetch costs at most the
  // slowest single source instead of the sum of all sources.
  const reports = await Promise.allSettled(activeSources.map((source) => ingestFromSource(source)));

  for (let index = 0; index < reports.length; index += 1) {
    const settled = reports[index];
    const source = activeSources[index];
    if (settled.status === "rejected") {
      lastError = { code: "unknown_error", message: `${source.name}: خطای غیرمنتظره هنگام دریافت`, detail: String(settled.reason).slice(0, 200) };
      bySource.push({ name: source.name, fetched: 0, stored: 0, duplicates: 0 });
      continue;
    }
    const report = settled.value;
    if (report.ok) {
      fetched += report.itemsFound;
      stored += report.itemsCreated;
      duplicates += report.duplicates;
      skipped += report.skippedMalformed;
      bySource.push({ name: source.name, fetched: report.itemsFound, stored: report.itemsCreated, duplicates: report.duplicates });
    } else {
      // One broken source must not stop the others; remember it for reporting.
      lastError = { code: report.code, message: `${source.name}: ${report.message}`, detail: report.detail ?? null };
      bySource.push({ name: source.name, fetched: 0, stored: 0, duplicates: 0 });
    }
  }

  if (stored === 0 && duplicates === 0 && fetched === 0 && lastError) {
    return { ok: false, ...lastError };
  }

  const firstName = bySource[0]?.name ?? "sources";
  return {
    ok: true,
    source: bySource.length > 1 ? `${bySource.length} منبع` : firstName,
    fetched,
    stored,
    duplicates,
    skipped,
    bySource,
  };
}

export type FeedImportReport = {
  feedTitle: string;
  itemsFound: number;
  itemsCreated: number;
  duplicates: number;
  skipped: number;
};

/**
 * Manual RSS/XML import (Milestone 6+, for sources this server cannot reach —
 * e.g. Iranian sites geo-blocking foreign IPs): the admin pastes the feed XML
 * they fetched on their own machine, and it runs through the EXACT same
 * parse → normalize → canonicalize → dedupe → store stages as a live fetch.
 * Nothing is sent anywhere; duplicate rules are identical.
 */
export async function ingestFeedXml(
  xml: string,
  source: NewsSourceRow | null,
): Promise<{ ok: true; report: FeedImportReport } | { ok: false; message: string }> {
  const body = xml.trim();
  if (!body) return { ok: false, message: "متن XML خالی است." };
  if (body.length > 3_000_000) return { ok: false, message: "حجم XML بیش از ۳ مگابایت است." };
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 4000))) {
    return { ok: false, message: "متن واردشده یک فید RSS/Atom/RDF نیست." };
  }

  const fallbackName = source?.name ?? "import";
  const parsed = parseFeed(body, fallbackName);
  if (parsed.items.length === 0) {
    return { ok: false, message: "هیچ آیتم قابل‌استفاده‌ای در XML پیدا نشد." };
  }

  const startedAt = new Date();
  try {
    const candidates = dedupeWithinBatch(toCandidates(parsed.items, source?.maxItemsPerFetch ?? 100));
    const { byCanonical, byExternalId } = await findExistingMatches(candidates);

    const fresh: Candidate[] = [];
    const duplicateRefs: Array<{ candidate: Candidate; originalId: string }> = [];
    for (const candidate of candidates) {
      const originalId = byCanonical.get(candidate.canonical) ?? (candidate.item.externalId ? byExternalId.get(candidate.item.externalId) : undefined);
      if (originalId) duplicateRefs.push({ candidate, originalId });
      else fresh.push(candidate);
    }

    const { created } = await storeCandidates(fresh, duplicateRefs, source, { sourceName: parsed.source });
    const duplicates = Math.max(candidates.length - created, 0);

    if (source) {
      await recordRun(source.id, startedAt, "success", { itemsFound: parsed.items.length, created, duplicates, skipped: parsed.skipped }, null, "manual import");
      await updateSourceAfterSuccess(source.id, parsed.items.length, created, duplicates);
    }

    return {
      ok: true,
      report: { feedTitle: parsed.source, itemsFound: parsed.items.length, itemsCreated: created, duplicates, skipped: parsed.skipped },
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `خطا در ذخیره‌سازی ورودی: ${detail.slice(0, 160)}` };
  }
}

/**
 * Scheduler replacement (minimal, no external services): one pass over every
 * ACTIVE rss source whose interval has elapsed. One failing source never stops
 * the others. Triggered by the admin "Fetch Due Sources" action.
 */
export async function runDueSources(now = new Date()): Promise<{
  considered: number;
  fetched: number;
  results: Array<{ sourceId: string; sourceName: string; status: "fetched" | "skipped" | "failed"; detail?: string }>;
}> {
  const activeSources = await db.select().from(newsSources).where(and(eq(newsSources.active, true), eq(newsSources.type, "rss"))).orderBy(desc(newsSources.priority));

  const results: Array<{ sourceId: string; sourceName: string; status: "fetched" | "skipped" | "failed"; detail?: string }> = [];
  let fetched = 0;

  for (const source of activeSources) {
    const intervalMs = Math.max(1, source.fetchIntervalMinutes) * 60_000;
    const due = !source.lastAttemptAt || now.getTime() - source.lastAttemptAt.getTime() >= intervalMs;

    if (!due) {
      results.push({ sourceId: source.id, sourceName: source.name, status: "skipped", detail: "هنوز زمان دریافت بعدی فرا نرسیده است." });
      continue;
    }

    // ingestFromSource never throws; wrap anyway so a DB hiccup here cannot
    // abort the sweep for the remaining sources.
    try {
      const report = await ingestFromSource(source);
      if (report.ok) {
        fetched += 1;
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          status: "fetched",
          detail: `${report.itemsCreated} جدید، ${report.duplicates} تکراری`,
        });
      } else {
        results.push({ sourceId: source.id, sourceName: source.name, status: "failed", detail: report.message });
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({ sourceId: source.id, sourceName: source.name, status: "failed", detail: detail.slice(0, 200) });
    }
  }

  return { considered: activeSources.length, fetched, results };
}

async function recordRun(
  sourceId: string,
  startedAt: Date,
  status: "success" | "partial" | "failed",
  counts: { itemsFound: number; created: number; duplicates: number; skipped: number },
  errorMessage: string | null,
  detail: string | null,
): Promise<void> {
  try {
    await db.insert(ingestionRuns).values({
      sourceId,
      startedAt,
      completedAt: new Date(),
      status,
      itemsFound: counts.itemsFound,
      itemsCreated: counts.created,
      duplicates: counts.duplicates,
      errors: counts.skipped + (status === "failed" ? 1 : 0),
      errorMessage: detail ? `${errorMessage ?? ""} — ${detail}`.slice(0, 1000) : errorMessage,
    });
  } catch (error) {
    // The run log is diagnostics; never let it fail the ingestion itself.
    console.error("[ingest] failed to write run log:", String(error).slice(0, 160));
  }
}

async function updateSourceAfterSuccess(sourceId: string, itemsFound: number, created: number, duplicates: number): Promise<void> {
  const now = new Date();
  try {
    await db
      .update(newsSources)
      .set({
        lastSuccessAt: now,
        lastAttemptAt: now,
        lastError: null,
        // Cumulative counters, computed in SQL so concurrent paths cannot clobber each other.
        totalFetched: sql`${newsSources.totalFetched} + ${itemsFound}`,
        totalAccepted: sql`${newsSources.totalAccepted} + ${created}`,
        totalDuplicates: sql`${newsSources.totalDuplicates} + ${duplicates}`,
        updatedAt: now,
      })
      .where(eq(newsSources.id, sourceId));
  } catch {
    // Stats are diagnostics; never fail the ingestion over them.
  }
}

async function updateSourceAfterFailure(sourceId: string, message: string): Promise<void> {
  const now = new Date();
  try {
    await db
      .update(newsSources)
      .set({
        lastAttemptAt: now,
        lastError: message.slice(0, 500),
        errorCount: sql`${newsSources.errorCount} + 1`,
        updatedAt: now,
      })
      .where(eq(newsSources.id, sourceId));
  } catch {
    // best effort
  }
}
