/**
 * News source management service (Milestone 6) — SERVER-SIDE ONLY.
 *
 * CRUD for registered sources + health derivation. Health is computed from the
 * columns the pipeline already maintains (lastSuccessAt / lastAttemptAt /
 * errorCount) with simple, documented rules — no arbitrary scoring.
 */

import { db } from "@/db";
import { ingestionRuns, newsSources, type NewsSourceRow } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import type { SourceHealth } from "./status";

export type SourceInput = {
  name: string;
  type: "rss" | "api";
  url: string;
  description?: string | null;
  category?: string | null;
  priority: number;
  active: boolean;
  fetchIntervalMinutes: number;
  maxItemsPerFetch: number;
};

export type SourceValidation = { valid: true; value: SourceInput } | { valid: false; errors: string[] };

export function validateSourceInput(input: Partial<SourceInput>): SourceValidation {
  const errors: string[] = [];

  const name = input.name?.trim() ?? "";
  if (!name) errors.push("نام منبع نمی‌تواند خالی باشد.");

  const url = input.url?.trim() ?? "";
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }
  if (!parsedUrl || (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:")) {
    errors.push("آدرس منبع باید یک URL معتبر http(s) باشد.");
  }

  const type = input.type === "api" ? "api" : "rss";
  const priority = Math.min(Math.max(Number.isFinite(input.priority as number) ? (input.priority as number) : 3, 1), 5);
  const fetchIntervalMinutes = Math.min(Math.max(Math.round(input.fetchIntervalMinutes ?? 30) || 30, 1), 7 * 24 * 60);
  const maxItemsPerFetch = Math.min(Math.max(Math.round(input.maxItemsPerFetch ?? 50) || 50, 1), 200);

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      name,
      type,
      url,
      description: input.description?.trim() || null,
      category: input.category?.trim() || null,
      priority,
      active: input.active !== false,
      fetchIntervalMinutes,
      maxItemsPerFetch,
    },
  };
}

export function computeSourceHealth(source: NewsSourceRow, now = Date.now()): SourceHealth {
  if (!source.active) return "paused";

  const staleMs = Math.max(source.fetchIntervalMinutes, 30) * 60_000 * 3;

  if (!source.lastSuccessAt) {
    // Never fetched successfully: "warning" before the first attempt, "failed" after one.
    return source.lastAttemptAt ? "failed" : "warning";
  }

  const sinceSuccess = now - source.lastSuccessAt.getTime();
  if (sinceSuccess > staleMs * 4) return "failed";

  const lastAttemptFailed = Boolean(source.lastAttemptAt && source.lastAttemptAt.getTime() > source.lastSuccessAt.getTime());
  if (sinceSuccess > staleMs || lastAttemptFailed) return "warning";

  return "healthy";
}

export type AdminSourceView = {
  id: string;
  name: string;
  type: string;
  url: string;
  description: string | null;
  category: string | null;
  priority: number;
  active: boolean;
  fetchIntervalMinutes: number;
  maxItemsPerFetch: number;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  errorCount: number;
  totalFetched: number;
  totalAccepted: number;
  totalDuplicates: number;
  health: SourceHealth;
  createdAt: string;
  updatedAt: string;
};

function toView(source: NewsSourceRow): AdminSourceView {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    url: source.url,
    description: source.description,
    category: source.category,
    priority: source.priority,
    active: source.active,
    fetchIntervalMinutes: source.fetchIntervalMinutes,
    maxItemsPerFetch: source.maxItemsPerFetch,
    lastSuccessAt: source.lastSuccessAt ? source.lastSuccessAt.toISOString() : null,
    lastAttemptAt: source.lastAttemptAt ? source.lastAttemptAt.toISOString() : null,
    lastError: source.lastError,
    errorCount: source.errorCount,
    totalFetched: source.totalFetched,
    totalAccepted: source.totalAccepted,
    totalDuplicates: source.totalDuplicates,
    health: computeSourceHealth(source),
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}

export async function listSourcesForAdmin(): Promise<AdminSourceView[]> {
  const rows = await db.select().from(newsSources).orderBy(desc(newsSources.priority), desc(newsSources.createdAt));
  return rows.map(toView);
}

export async function getSourceById(id: string): Promise<NewsSourceRow | null> {
  const [row] = await db.select().from(newsSources).where(eq(newsSources.id, id)).limit(1);
  return row ?? null;
}

export async function createSource(input: Partial<SourceInput>): Promise<AdminSourceView> {
  const validated = validateSourceInput(input);
  if (!validated.valid) {
    throw new SourceInputError(validated.errors);
  }

  const [row] = await db.insert(newsSources).values(validated.value).returning();
  return toView(row);
}

export class SourceInputError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(errors.join("؛ "));
    this.errors = errors;
  }
}

export async function updateSource(id: string, patch: Partial<SourceInput>): Promise<AdminSourceView | null> {
  const existing = await getSourceById(id);
  if (!existing) return null;

  const validated = validateSourceInput({
    name: patch.name ?? existing.name,
    type: (patch.type ?? existing.type) as SourceInput["type"],
    url: patch.url ?? existing.url,
    description: patch.description ?? existing.description,
    category: patch.category ?? existing.category,
    priority: patch.priority ?? existing.priority,
    active: patch.active ?? existing.active,
    fetchIntervalMinutes: patch.fetchIntervalMinutes ?? existing.fetchIntervalMinutes,
    maxItemsPerFetch: patch.maxItemsPerFetch ?? existing.maxItemsPerFetch,
  });
  if (!validated.valid) {
    throw new SourceInputError(validated.errors);
  }

  const [row] = await db
    .update(newsSources)
    .set({ ...validated.value, updatedAt: new Date() })
    .where(eq(newsSources.id, id))
    .returning();

  return toView(row);
}

export async function deleteSource(id: string): Promise<boolean> {
  const deleted = await db.delete(newsSources).where(eq(newsSources.id, id)).returning({ id: newsSources.id });
  return deleted.length > 0;
}

export type RunView = {
  id: string;
  sourceId: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  itemsFound: number;
  itemsCreated: number;
  itemsFiltered: number;
  duplicates: number;
  errors: number;
  errorMessage: string | null;
};

export async function listRecentRuns(limit = 25): Promise<RunView[]> {
  const rows = await db.select().from(ingestionRuns).orderBy(desc(ingestionRuns.startedAt)).limit(Math.min(Math.max(limit, 1), 100));

  return rows.map((row) => ({
    id: row.id,
    sourceId: row.sourceId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    itemsFound: row.itemsFound,
    itemsCreated: row.itemsCreated,
    itemsFiltered: row.itemsFiltered,
    duplicates: row.duplicates,
    errors: row.errors,
    errorMessage: row.errorMessage,
  }));
}

export function summarizeSources(views: AdminSourceView[]) {
  return {
    total: views.length,
    active: views.filter((view) => view.active).length,
    healthy: views.filter((view) => view.health === "healthy").length,
    warning: views.filter((view) => view.health === "warning").length,
    failed: views.filter((view) => view.health === "failed").length,
  };
}
