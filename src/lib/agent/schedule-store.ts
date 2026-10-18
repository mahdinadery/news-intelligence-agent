/**
 * Scheduled publishing configuration — persistence (SERVER-SIDE ONLY).
 *
 * Exactly one row in `agent_schedules` holds the whole schedule. This module
 * keeps read/write idempotent and safe on a fresh or drifted database:
 *  - missing table/columns are repaired once via the shared additive sync,
 *  - if the database is unreachable the caller still gets the defaults (the
 *    dashboard renders, and the scheduler simply does not run).
 */

import { db } from "@/db";
import { agentSchedules, type AgentScheduleRow } from "@/db/schema";
import { ensureSchemaOnce } from "@/lib/admin/schema-sync";
import { isSchemaMismatchError } from "@/lib/admin/db-errors";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  DEFAULT_AGENT_SCHEDULE,
  coerceScheduleConfig,
  type AgentRunSummary,
  type AgentScheduleConfig,
} from "./schedule";

export type AgentScheduleRecord = AgentScheduleConfig & {
  /** null when nothing has been persisted yet (DB unavailable). */
  id: string | null;
  lastRunAt: Date | null;
  lastRunSlot: string | null;
  lastResult: AgentRunSummary | null;
  /** When the coverage-gap search last ran (cooldown input). */
  lastGapSearchAt: Date | null;
};

function toRecord(row: AgentScheduleRow): AgentScheduleRecord {
  return {
    id: row.id,
    lastRunAt: row.lastRunAt ?? null,
    lastRunSlot: row.lastRunSlot ?? null,
    lastResult: row.lastResult ?? null,
    lastGapSearchAt: row.lastGapSearchAt ?? null,
    ...coerceScheduleConfig({
      enabled: row.enabled,
      timezone: row.timezone,
      times: row.times,
      destination: row.destination,
      minImportance: row.minImportance,
      minRelevance: row.minRelevance,
      minNovelty: row.minNovelty,
      requireAiRecommendation: row.requireAiRecommendation,
      maxAnalyze: row.maxAnalyze,
      maxSend: row.maxSend,
      gapSearchEnabled: row.gapSearchEnabled,
      gapSearchQueries: row.gapSearchQueries,
    }),
  };
}

const FALLBACK: AgentScheduleRecord = {
  id: null,
  lastRunAt: null,
  lastRunSlot: null,
  lastResult: null,
  lastGapSearchAt: null,
  ...DEFAULT_AGENT_SCHEDULE,
};

function valuesFor(config: AgentScheduleConfig) {
  return {
    enabled: config.enabled,
    timezone: config.timezone,
    times: config.times,
    destination: config.destination,
    minImportance: config.minImportance,
    minRelevance: config.minRelevance,
    minNovelty: config.minNovelty,
    requireAiRecommendation: config.requireAiRecommendation,
    maxAnalyze: config.maxAnalyze,
    maxSend: config.maxSend,
    gapSearchEnabled: config.gapSearchEnabled,
    // jsonb column (notNull, defaults to []): pass the array directly.
    gapSearchQueries: config.gapSearchQueries ?? [],
    updatedAt: new Date(),
  };
}

async function selectFirst(): Promise<AgentScheduleRow | undefined> {
  const rows = await db.select().from(agentSchedules).orderBy(asc(agentSchedules.createdAt)).limit(1);
  return rows[0];
}

/**
 * Reads the schedule, creating the default row on first use. Repairs a drifted
 * schema once and retries. Falls back to defaults if the DB is unreachable.
 */
export async function readScheduleRecord(): Promise<AgentScheduleRecord> {
  try {
    let row: AgentScheduleRow | undefined;
    try {
      row = await selectFirst();
      if (!row) {
        const [created] = await db
          .insert(agentSchedules)
          .values(valuesFor(DEFAULT_AGENT_SCHEDULE))
          .returning();
        row = created;
      }
    } catch (error) {
      if (!isSchemaMismatchError(error)) throw error;
      const repair = await ensureSchemaOnce();
      if (!repair.ok) throw error;
      row = (await selectFirst()) ?? undefined;
      if (!row) {
        const [created] = await db
          .insert(agentSchedules)
          .values(valuesFor(DEFAULT_AGENT_SCHEDULE))
          .returning();
        row = created;
      }
    }

    return row ? toRecord(row) : { ...FALLBACK };
  } catch (error) {
    console.error("[schedule] read failed:", String(error).slice(0, 200));
    return { ...FALLBACK };
  }
}

/** Saves the configuration (creates the single row when needed). */
export async function saveScheduleConfig(config: AgentScheduleConfig): Promise<AgentScheduleRecord> {
  const existing = await readScheduleRecord();

  if (existing.id) {
    const [updated] = await db
      .update(agentSchedules)
      .set(valuesFor(config))
      .where(eq(agentSchedules.id, existing.id))
      .returning();
    return toRecord(updated);
  }

  const [created] = await db.insert(agentSchedules).values(valuesFor(config)).returning();
  return toRecord(created);
}

/**
 * Atomically marks a slot as claimed. Returns false when another request
 * already claimed it (or the row vanished), so a slow run can never be started
 * twice by overlapping cron ticks.
 */
export async function claimSlot(id: string | null, slotKey: string): Promise<boolean> {
  if (!id) return true; // Nothing persisted (DB down) — the run will fail anyway.

  try {
    const claimed = await db
      .update(agentSchedules)
      .set({ lastRunSlot: slotKey, lastRunAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentSchedules.id, id), sql`${agentSchedules.lastRunSlot} IS DISTINCT FROM ${slotKey}`))
      .returning({ id: agentSchedules.id });

    return claimed.length > 0;
  } catch (error) {
    console.error("[schedule] claim failed:", String(error).slice(0, 200));
    return false;
  }
}

/**
 * Stamps the coverage-gap search cooldown on the singleton row. Best-effort:
 * a failure here must never abort a run that already produced results.
 */
export async function markGapSearchRun(): Promise<void> {
  try {
    await db
      .update(agentSchedules)
      .set({ lastGapSearchAt: new Date(), updatedAt: new Date() })
      .where(sql`true`);
  } catch (error) {
    console.error("[schedule] gap-stamp failed:", String(error).slice(0, 200));
  }
}

/** Stores the outcome of a pass (best effort — never fails the run itself). */
export async function recordRunResult(id: string | null, summary: AgentRunSummary): Promise<void> {
  if (!id) return;

  try {
    await db
      .update(agentSchedules)
      .set({ lastResult: summary, lastRunAt: new Date(summary.startedAt), updatedAt: new Date() })
      .where(eq(agentSchedules.id, id));
  } catch (error) {
    console.error("[schedule] could not store run result:", String(error).slice(0, 200));
  }
}
