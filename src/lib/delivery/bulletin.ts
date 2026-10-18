/**
 * Bulletin (digest) message builder — Phase 2 roadmap task #4.
 *
 * PURE MODULE (no runtime imports; type-only is fine) so the Node test runner
 * can import it. Sending/DB live in `delivery/index.ts`; the AI intro is
 * synthesized in `ai/bulletin-brief.ts`.
 *
 * Layout (the operator picked "AI brief + minimal columns"):
 *
 *   🗞️ بولتن خبری — <date>
 *   <AI intro paragraph, 2–4 sentences>
 *
 *   1️⃣ <title>
 *   <one-liner>
 *   چرا مهم است: <why>
 *   🔗 <url>
 *   ...
 */

/** Upper bound of items packed into one digest (roadmap: 3–5). */
export const MAX_BULLETIN_ITEMS = 5;

export type BulletinItem = {
  id: string;
  title: string;
  /** Compact one-liner (usually the stored summary). */
  oneLiner: string | null;
  whyItMatters: string | null;
  url: string;
  importanceScore: number | null;
  publishedAt: Date | null;
  /** Phase 3: multi-source confirmation — shows the «تأییدشده» badge. */
  corroborated?: boolean;
  /** Phase 3: Persian entity names (banks/companies/institutions). */
  entityTags?: string[];
};

const NUMBER_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

function compact(text: string | null | undefined, max: number): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Ranks candidates and takes the top `max`: highest importance first, newest
 * first on ties. Pure — the caller supplies already rule-approved items.
 */
export function pickBulletinItems<T extends { importanceScore: number | null; publishedAt: Date | null }>(
  items: T[],
  max: number = MAX_BULLETIN_ITEMS,
): T[] {
  return [...items]
    .sort((a, b) => {
      const importance = (b.importanceScore ?? 0) - (a.importanceScore ?? 0);
      if (importance !== 0) return importance;
      return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
    })
    .slice(0, Math.max(0, Math.min(max, MAX_BULLETIN_ITEMS)));
}

export function buildBulletinMessage(args: {
  /** AI-synthesized intro (null/empty => no intro block). */
  intro: string | null;
  items: BulletinItem[];
  generatedAt: Date;
  /** IANA timezone for the header date (e.g. "Asia/Tehran"). */
  timezone: string;
}): string {
  const { intro, items, generatedAt, timezone } = args;

  let dateLabel = generatedAt.toISOString().slice(0, 10);
  try {
    dateLabel = generatedAt.toLocaleDateString("fa-IR", {
      timeZone: timezone,
      dateStyle: "medium",
    });
  } catch {
    // Invalid timezone => keep the ISO date.
  }

  const lines: string[] = [`🗞️ بولتن خبری — ${dateLabel}`];

  const introText = compact(intro, 600);
  if (introText) {
    lines.push("", introText);
  }

  items.forEach((item, index) => {
    const marker = NUMBER_EMOJI[index] ?? `${index + 1}.`;
    lines.push("", `${marker} ${compact(item.title, 160)}`);
    const oneLiner = compact(item.oneLiner, 220);
    if (oneLiner) lines.push(oneLiner);
    const why = compact(item.whyItMatters, 220);
    if (why) lines.push(`چرا مهم است: ${why}`);
    const entities = (item.entityTags ?? []).slice(0, 4).join("، ");
    if (entities) lines.push(`نهادها: ${entities}`);
    if (item.corroborated) lines.push("تأییدشده توسط چند منبع ✓");
    lines.push(`🔗 ${item.url}`);
  });

  return lines.join("\n");
}
