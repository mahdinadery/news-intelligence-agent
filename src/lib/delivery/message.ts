import type { NewsRow } from "@/db/schema";

/**
 * Renders the admin-facing Persian message shared by every provider.
 *
 * Both Local and Bale receive EXACTLY this text, so Local stays a faithful
 * rehearsal of a real Bale delivery. Internal AI fields (novelty, relevance and
 * the reasoning) are intentionally excluded — they remain visible in the
 * Dashboard only.
 */

const MAX_SUMMARY_LENGTH = 600;

function compact(value: string | null | undefined, limit: number): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "—";
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function formatImportance(score: number | null): string {
  if (score === null || Number.isNaN(score)) return "ثبت نشده";
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const label = clamped >= 70 ? "بالا" : clamped >= 40 ? "متوسط" : "پایین";
  return `${clamped} از ۱۰۰ (${label})`;
}

/**
 * Optional Phase 3 extras (corroboration / entities / related stories) — the
 * caller resolves them from the DB; this function stays pure and testable.
 */
export type MessageExtras = {
  /** Every source carrying this event (multi-source confirmation) — with links. */
  corroborationItems?: Array<{ source: string; url: string }>;
  /** Persian entity names (banks/companies/institutions) from the AI output. */
  entityTags?: string[];
  /** Titles of previously delivered related stories (follow-ups). */
  relatedTitles?: string[];
};

export function buildNewsMessage(article: NewsRow, extras: MessageExtras = {}): string {
  const why = article.whyItMatters?.trim();
  const entities = (extras.entityTags ?? article.entityTags ?? []).slice(0, 6).join("، ");
  const related = (extras.relatedTitles ?? []).slice(0, 2);

  // Multi-source: ONE chosen story, every outlet listed underneath with its
  // link (the chosen copy first). Single-source keeps the classic one-liner.
  const others = (extras.corroborationItems ?? []).slice(0, 4);
  const sourcesBlock =
    others.length > 0
      ? [
          "",
          `منابع این خبر (${(others.length + 1).toLocaleString("fa-IR")}):`,
          `• ${compact(article.source, 60)} (انتخاب‌شده): ${article.url}`,
          ...others.map((item) => `• ${compact(item.source, 60)}: ${item.url}`),
        ]
      : ["", "🔗 منبع:", article.url];

  return [
    "📰 عنوان خبر",
    "",
    compact(article.title, 300),
    "",
    "خلاصه:",
    compact(article.summary, MAX_SUMMARY_LENGTH),
    ...(why ? ["", "چرا مهم است:", compact(why, 300)] : []),
    ...(entities ? ["", "نهادها:", entities] : []),
    ...related.flatMap((title) => ["", "مرتبط با:", compact(title, 140)]),
    "",
    "دسته:",
    compact(article.category, 60),
    "",
    "اهمیت:",
    formatImportance(article.importanceScore),
    ...sourcesBlock,
  ].join("\n");
}
