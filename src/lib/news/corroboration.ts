/**
 * Multi-source confirmation (roadmap Phase 3, task #10) — PURE LOGIC ONLY.
 *
 * The same event often appears on several outlets within hours (IRNA + ISNA +
 * …). A cheap, deterministic "similarity key" derived from the title groups
 * those stories: when 2+ DISTINCT sources carry the same key, the event is
 * corroborated («تأییدشده») and gets a small importance bonus — relevance is
 * NEVER touched (the strict AND rule is sacred).
 *
 * Imported by the Node test runner: no runtime imports allowed (type-only ok).
 */

/** Importance bonus applied once an event is corroborated by 2+ sources. */
export const CORROBORATION_BONUS = 10;

/** Minimum distinct sources before an event counts as corroborated. */
export const CORROBORATION_MIN_SOURCES = 2;

const PERSIAN_STOPWORDS = new Set([
  "از", "به", "در", "با", "برای", "که", "این", "آن", "را", "است", "شد", "شود",
  "شدن", "بود", "بودن", "هست", "می", "نمی", "ها", "های", "تر", "ترین", "یک",
  "دو", "سه", "و", "یا", "اما", "تا", "پس", "هم", "طی", "وی",
  "توسط", "شده", "یافت", "یافته", "داد", "داده", "کرد", "کردن", "گفت", "افزود",
  "می‌شود", "می‌کند", "می‌دهد", "خواهد", "شدند", "شوند", "نبود", "استاندارد",
  "the", "and", "for", "with", "from", "that", "this", "was", "are", "has",
]);

/**
 * Deterministic fingerprint of a news title: lowercase, punctuation/harakat
 * stripped, stop-words dropped, then the 4 longest content words sorted
 * alphabetically (order-independent, robust to rephrasing word order).
 * Returns "" when the title is too thin to fingerprint (< 2 content words).
 */
export function similarityKeyOf(title: string): string {
  const normalized = (title ?? "")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const words = normalized
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !PERSIAN_STOPWORDS.has(word));

  const distinct = [...new Set(words)];
  if (distinct.length < 2) return "";

  // Deterministic total order: longest first, alphabetical on ties — so the
  // same word set ALWAYS yields the same key regardless of word order.
  return distinct
    .sort((a, b) => b.length - a.length || a.localeCompare(b, "fa"))
    .slice(0, 4)
    .join("_");
}

/** Importance bonus for a corroborated event (0 when not corroborated). */
export function corroborationBonus(distinctSources: number): number {
  return distinctSources >= CORROBORATION_MIN_SOURCES ? CORROBORATION_BONUS : 0;
}
