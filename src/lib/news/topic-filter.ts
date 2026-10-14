/**
 * Topic / relevance gate — SERVER-SIDE, pure logic (no DB, no network).
 *
 * Runs BEFORE the expensive AI analysis stage:
 *
 *   fetch -> parse -> normalize -> dedupe -> [TOPIC FILTER] -> AI -> delivery
 *
 * Deliberately keyword/rule based (NOT an LLM call): matching is a handful of
 * substring checks, so filtering 50 articles costs microseconds instead of a
 * model round-trip. Articles that fail the gate are STORED with the
 * SKIPPED_OFFTOPIC status (never silently discarded) and can be re-queued from
 * the admin UI after the topics change.
 *
 * FAIL-OPEN CONTRACT (important): when the filter is disabled, has no topics,
 * or no enabled topic carries a keyword, EVERY article passes. The filter can
 * therefore never lose news on its own — it only narrows what reaches the AI
 * when the operator explicitly configured topics.
 */

import type { AiTopicFilterConfig, AiTopicRule } from "@/lib/ai/config-types";

/**
 * Normalizes text for Persian-friendly matching:
 * - lowercases Latin text
 * - folds Arabic letter variants into Persian forms (ي→ی, ك→ک, ...)
 * - strips diacritics, tatweel and zero-width joiners (ZWNJ included, so
 *   «می‌شود» and «میشود» compare equal)
 * - collapses whitespace
 */
export function normalizeForMatch(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // diacritics + tatweel + superscript alef
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, "") // zero-width + directional marks (incl. ZWNJ/ZWJ)
    .replace(/[\u064A\u0649\u06D2]/g, "\u06CC") // ي ى ے -> ی
    .replace(/\u0643/g, "\u06A9") // ك -> ک
    .replace(/\u0629/g, "\u0647") // ة -> ه
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627") // آ أ إ ٱ -> ا
    .replace(/\s+/g, " ")
    .trim();
}

function topicMatches(topic: AiTopicRule, haystack: string): boolean {
  if (!topic.enabled) return false;
  for (const raw of topic.keywords) {
    const keyword = normalizeForMatch(raw);
    if (keyword && haystack.includes(keyword)) return true;
  }
  return false;
}

export type TopicFilterArticle = {
  title: string | null | undefined;
  description?: string | null;
  content?: string | null;
};

export type TopicFilterOutcome =
  /** The filter is inactive / not effective: everything passes. */
  | { verdict: "pass"; reason: "filter_disabled" | "no_effective_topics"; matchedTopics: string[] }
  /** Explicit evaluation against configured topics. */
  | { verdict: "pass"; reason: "matched_topic" | "no_excluded_match"; matchedTopics: string[] }
  | { verdict: "skip"; reason: "not_in_selected_topics" | "matched_excluded_topic"; matchedTopics: string[] };

/**
 * Evaluates one article against the topic filter.
 *
 * include mode: pass iff at least one enabled topic matches (OR across topics).
 * exclude mode: skip iff at least one enabled topic matches.
 */
export function evaluateTopicFilter(
  article: TopicFilterArticle,
  filter: AiTopicFilterConfig | null | undefined,
): TopicFilterOutcome {
  if (!filter || !filter.enabled) {
    return { verdict: "pass", reason: "filter_disabled", matchedTopics: [] };
  }

  const effective = (filter.topics ?? []).filter((topic) => topic.enabled && topic.keywords.some((k) => normalizeForMatch(k)));
  if (effective.length === 0) {
    // Misconfiguration safety net: never drop news just because topics are empty.
    return { verdict: "pass", reason: "no_effective_topics", matchedTopics: [] };
  }

  const haystack = normalizeForMatch([article.title, article.description, article.content].filter(Boolean).join(" \u2000 "));
  const matchedTopics: string[] = [];
  for (const topic of effective) {
    if (topicMatches(topic, haystack)) matchedTopics.push(topic.label.trim() || topic.id);
  }

  const matched = matchedTopics.length > 0;

  if (filter.mode === "exclude") {
    return matched
      ? { verdict: "skip", reason: "matched_excluded_topic", matchedTopics }
      : { verdict: "pass", reason: "no_excluded_match", matchedTopics: [] };
  }

  return matched
    ? { verdict: "pass", reason: "matched_topic", matchedTopics }
    : { verdict: "skip", reason: "not_in_selected_topics", matchedTopics: [] };
}

/** True when the filter would actually narrow anything (used to skip work entirely). */
export function isTopicFilterActive(filter: AiTopicFilterConfig | null | undefined): boolean {
  if (!filter || !filter.enabled) return false;
  return (filter.topics ?? []).some((topic) => topic.enabled && topic.keywords.some((k) => normalizeForMatch(k)));
}

/**
 * Human-readable focus description for the AI prompt, or null when the filter
 * is not active. Keeps the model aware of the operator's topic focus without
 * changing any of the existing analysis output fields.
 */
export function describeTopicFocus(filter: AiTopicFilterConfig | null | undefined): string | null {
  if (!filter || !filter.enabled) return null;
  const effective = (filter.topics ?? []).filter((topic) => topic.enabled && topic.keywords.some((k) => normalizeForMatch(k)));
  if (effective.length === 0) return null;

  const lines = effective.map((topic) => {
    const keywords = topic.keywords.map((k) => k.trim()).filter(Boolean).join("، ");
    return keywords ? `- ${topic.label.trim() || topic.id}: ${keywords}` : `- ${topic.label.trim() || topic.id}`;
  });

  return [
    `تمرکز موضوعی فعلی سامانه (حالت ${filter.mode === "exclude" ? "حذف موضوعات زیر" : "تمرکز روی موضوعات زیر"}):`,
    ...lines,
  ].join("\n");
}

/** Preset topic suggestions offered by the admin UI (labels + starter keywords). */
export const TOPIC_PRESETS: Array<{ label: string; keywords: string[] }> = [
  { label: "بازار خودرو", keywords: ["خودرو", "خودروساز", "قیمت خودرو", "واردات خودرو", "بازار خودرو"] },
  { label: "مسکن", keywords: ["مسکن", "ملک", "ساخت‌وساز", "قیمت مسکن", "رهن", "اجاره"] },
  { label: "انرژی", keywords: ["انرژی", "نفت", "گاز", "برق", "بنزین", "پتروشیمی"] },
  { label: "سیاست پولی", keywords: ["بانک مرکزی", "نرخ بهره", "نقدینگی", "تورم", "ارز", "دلار", "سیاست پولی"] },
  { label: "تجارت خارجی", keywords: ["تجارت خارجی", "صادرات", "واردات", "گمرک", "ترجیحی", "توافق‌نامه تجاری"] },
];
