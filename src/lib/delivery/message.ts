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

export function buildNewsMessage(article: NewsRow): string {
  return [
    "📰 عنوان خبر",
    "",
    compact(article.title, 300),
    "",
    "خلاصه:",
    compact(article.summary, MAX_SUMMARY_LENGTH),
    "",
    "دسته:",
    compact(article.category, 60),
    "",
    "اهمیت:",
    formatImportance(article.importanceScore),
    "",
    "🔗 منبع:",
    article.url,
  ].join("\n");
}
