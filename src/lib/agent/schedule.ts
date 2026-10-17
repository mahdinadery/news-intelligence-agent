/**
 * Scheduled automatic publishing — pure logic (no DB, no network).
 *
 * The assistant can run a full "fetch → analyze → send" pass at fixed local
 * times (e.g. 08:00 and 20:00 in Asia/Tehran). This module owns everything that
 * can be unit-tested without a database:
 *
 *   - the schedule configuration shape + defaults + validation,
 *   - timezone-aware "is a slot due right now?" calculation,
 *   - the next scheduled run,
 *   - Persian descriptions for the dashboard.
 *
 * Times are stored as "HH:MM" wall-clock strings interpreted in `timezone`.
 * A slot stays runnable for `SCHEDULE_GRACE_MINUTES` after its nominal time so
 * a delayed cron / sleeping free-tier host still catches up exactly once
 * (`lastRunSlot` in the DB prevents double runs).
 */

import type { DeliveryTarget } from "@/lib/delivery/types";

export const SCHEDULE_TIMEZONES = [
  "Asia/Tehran",
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "Asia/Dubai",
  "Asia/Istanbul",
  "America/New_York",
] as const;

/**
 * How long after a slot's nominal time the scheduler may still start it.
 * Sized for free-tier hosts (cold start) and GitHub Actions cron delays.
 */
export const SCHEDULE_GRACE_MINUTES = 60;

export type AgentScheduleConfig = {
  enabled: boolean;
  /** IANA timezone the `times` are interpreted in. */
  timezone: string;
  /** Local wall-clock times, "HH:MM", sorted and unique. */
  times: string[];
  destination: DeliveryTarget;
  minImportance: number;
  minRelevance: number;
  minNovelty: number;
  requireAiRecommendation: boolean;
  /** How many pending articles one scheduled run may analyze. */
  maxAnalyze: number;
  /** Upper bound of articles sent in one scheduled run. */
  maxSend: number;
};

export type ScheduleIngestSummary = {
  attempted: boolean;
  sources: number;
  created: number;
  duplicates: number;
  failed: number;
  detail?: string;
};

export type ScheduleAnalysisSummary = {
  selected: number;
  analyzed: number;
  failed: number;
  skippedOfftopic: number;
};

export type ScheduleSendSummary = {
  enabled: boolean;
  destination: string;
  considered: number;
  matched: number;
  sent: number;
  skippedDuplicates: number;
  skippedReview: number;
  failed: number;
};

/** Result of one scheduled (or manually forced) full pass, stored on the row. */
export type AgentRunSummary = {
  ok: boolean;
  trigger: "schedule" | "manual";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  slotKey: string | null;
  ingest: ScheduleIngestSummary | null;
  analysis: ScheduleAnalysisSummary | null;
  send: ScheduleSendSummary | null;
  errors: string[];
};

export const DEFAULT_AGENT_SCHEDULE: AgentScheduleConfig = {
  enabled: false,
  timezone: "Asia/Tehran",
  times: ["08:00"],
  destination: "bale",
  minImportance: 50,
  minRelevance: 50,
  minNovelty: 0,
  requireAiRecommendation: false,
  maxAnalyze: 8,
  maxSend: 10,
};

export type TimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && HHMM_PATTERN.test(value);
}

/** "8:5" → "08:05"; invalid values are dropped. */
export function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Normalizes, dedupes and sorts a list of times. Invalid entries are dropped. */
export function normalizeTimes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const times = input
    .map((value) => normalizeTime(value))
    .filter((value): value is string => Boolean(value));
  return [...new Set(times)].sort();
}

export function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of `date` in `timeZone`. */
export function getZonedParts(date: Date, timeZone: string): TimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Some engines still emit "24" for midnight even with h23.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateKeyOf(parts: Pick<TimeParts, "year" | "month" | "day">): string {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** Milliseconds that `timeZone` is ahead of UTC at the given instant. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const truncated = Math.floor(date.getTime() / 60_000) * 60_000;
  return asUtc - truncated;
}

/** Converts a wall-clock time in `timeZone` to the matching UTC instant. */
export function zonedTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const minutes = timeToMinutes(time);
  const wall = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);

  let guess = wall;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = zoneOffsetMs(new Date(guess), timeZone);
    const next = wall - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

function addDaysToKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export type DueSlot =
  | { due: true; slotKey: string; slotAt: Date; slotTime: string }
  | { due: false; reason: "disabled" | "no_times" | "not_due" | "already_ran"; nextRunAt: Date | null };

/**
 * Decides whether any configured slot is currently runnable.
 *
 * A slot is runnable when the local time is within [`time`, `time + grace`) and
 * the exact slot (`YYYY-MM-DDTHH:MM` local) has not run yet (`lastRunSlot`).
 */
export function computeDueSlot(args: {
  now: Date;
  config: Pick<AgentScheduleConfig, "enabled" | "timezone" | "times">;
  lastRunSlot?: string | null;
  graceMinutes?: number;
}): DueSlot {
  const { now, config, lastRunSlot } = args;
  const grace = args.graceMinutes ?? SCHEDULE_GRACE_MINUTES;
  const times = normalizeTimes(config.times);

  if (!config.enabled) return { due: false, reason: "disabled", nextRunAt: null };
  if (times.length === 0) return { due: false, reason: "no_times", nextRunAt: null };

  const parts = getZonedParts(now, config.timezone);
  const dateKey = dateKeyOf(parts);
  const nowMinutes = parts.hour * 60 + parts.minute;

  let match: { slotKey: string; slotTime: string; minutes: number } | null = null;
  let alreadyRan = false;

  for (const time of times) {
    const minutes = timeToMinutes(time);
    if (nowMinutes < minutes || nowMinutes >= minutes + grace) continue;

    const slotKey = `${dateKey}T${time}`;
    if (lastRunSlot === slotKey) {
      alreadyRan = true;
      continue;
    }
    if (!match || minutes > match.minutes) match = { slotKey, slotTime: time, minutes };
  }

  const next = computeNextRun({ now, config });

  if (match) {
    return {
      due: true,
      slotKey: match.slotKey,
      slotTime: match.slotTime,
      slotAt: zonedTimeToUtc(dateKey, match.slotTime, config.timezone),
    };
  }

  return {
    due: false,
    reason: alreadyRan ? "already_ran" : "not_due",
    nextRunAt: next?.at ?? null,
  };
}

/**
 * First configured slot strictly after `now` (looks up to 14 days ahead).
 */
export function computeNextRun(args: {
  now: Date;
  config: Pick<AgentScheduleConfig, "timezone" | "times">;
}): { at: Date; slotKey: string; time: string } | null {
  const times = normalizeTimes(args.config.times);
  if (times.length === 0) return null;

  const todayKey = dateKeyOf(getZonedParts(args.now, args.config.timezone));

  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const dateKey = addDaysToKey(todayKey, dayOffset);
    for (const time of times) {
      const at = zonedTimeToUtc(dateKey, time, args.config.timezone);
      if (at.getTime() > args.now.getTime()) {
        return { at, slotKey: `${dateKey}T${time}`, time };
      }
    }
  }

  return null;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function readBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(lowered)) return true;
    if (["0", "false", "no", "off"].includes(lowered)) return false;
  }
  return fallback;
}

const DESTINATIONS: DeliveryTarget[] = ["local", "bale", "both"];

/**
 * Lenient read used for DB rows / API bodies: unknown/invalid fields fall back
 * to defaults instead of failing the whole request.
 */
export function coerceScheduleConfig(raw: Record<string, unknown> | null | undefined): AgentScheduleConfig {
  const source = raw ?? {};
  const times = normalizeTimes(source.times);
  const timezone =
    typeof source.timezone === "string" && isValidTimeZone(source.timezone.trim())
      ? source.timezone.trim()
      : DEFAULT_AGENT_SCHEDULE.timezone;
  const destination = DESTINATIONS.includes(source.destination as DeliveryTarget)
    ? (source.destination as DeliveryTarget)
    : DEFAULT_AGENT_SCHEDULE.destination;

  return {
    enabled: readBool(source.enabled, DEFAULT_AGENT_SCHEDULE.enabled),
    timezone,
    // An empty list is allowed while saving (the API validates it), but it can
    // never produce a runnable schedule.
    times: times.length > 0 ? times : [],
    destination,
    minImportance: clampInt(source.minImportance, DEFAULT_AGENT_SCHEDULE.minImportance, 0, 100),
    minRelevance: clampInt(source.minRelevance, DEFAULT_AGENT_SCHEDULE.minRelevance, 0, 100),
    minNovelty: clampInt(source.minNovelty, DEFAULT_AGENT_SCHEDULE.minNovelty, 0, 100),
    requireAiRecommendation: readBool(
      source.requireAiRecommendation,
      DEFAULT_AGENT_SCHEDULE.requireAiRecommendation,
    ),
    maxAnalyze: clampInt(source.maxAnalyze, DEFAULT_AGENT_SCHEDULE.maxAnalyze, 1, 30),
    maxSend: clampInt(source.maxSend, DEFAULT_AGENT_SCHEDULE.maxSend, 1, 50),
  };
}

export type ScheduleValidation =
  | { ok: true; config: AgentScheduleConfig }
  | { ok: false; errors: string[] };

/** Strict validation for save requests (returns Persian, actionable errors). */
export function validateScheduleInput(raw: unknown): ScheduleValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, errors: ["بدنه درخواست باید یک شیء JSON باشد."] };
  }

  const source = raw as Record<string, unknown>;
  const errors: string[] = [];

  const config = coerceScheduleConfig(source);

  if (!Array.isArray(source.times)) {
    errors.push("فهرست زمان‌ها (times) باید آرایه‌ای از رشته‌های HH:MM باشد.");
  } else {
    const invalid = source.times.filter((value) => normalizeTime(value) === null).length;
    const normalized = normalizeTimes(source.times);

    if (invalid > 0) {
      errors.push("برخی زمان‌ها نامعتبر بودند؛ قالب درست HH:MM است (مثلاً 08:30).");
    }
    if (config.enabled && normalized.length === 0) {
      errors.push("برای فعال‌سازی زمان‌بندی، حداقل یک زمان ارسال لازم است.");
    }
    // Duplicates are harmless and silently removed by normalizeTimes().
    config.times = normalized;
  }

  if (typeof source.timezone === "string" && !isValidTimeZone(source.timezone.trim())) {
    errors.push("منطقه زمانی نامعتبر است.");
  } else if (typeof source.timezone !== "string") {
    errors.push("منطقه زمانی (timezone) الزامی است.");
  }

  if (source.destination !== undefined && !DESTINATIONS.includes(source.destination as DeliveryTarget)) {
    errors.push("مقصد باید یکی از local، bale یا both باشد.");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, config };
}

const DESTINATION_LABELS: Record<DeliveryTarget, string> = {
  local: "صندوق محلی (Local)",
  bale: "بله",
  both: "بله و صندوق محلی",
};

export function destinationLabel(destination: DeliveryTarget): string {
  return DESTINATION_LABELS[destination] ?? destination;
}

/** Persian, human-readable summary for the dashboard card. */
export function describeSchedule(config: AgentScheduleConfig): string[] {
  if (!config.enabled) return ["زمان‌بندی خودکار: خاموش"];
  return [
    `ارسال خودکار: ${config.times.join(" و ")} (${config.timezone})`,
    `مقصد: ${destinationLabel(config.destination)}`,
    `در هر اجرا: حداکثر ${config.maxAnalyze} تحلیل و ${config.maxSend} ارسال`,
    `حداقل اهمیت ${config.minImportance}٪ · مرتبط بودن ${config.minRelevance}٪`,
  ];
}
