/** Bounded lexical retrieval, not embeddings. Pure and testable. */
export type MemoryDocument = { id: string; title: string; source: string; url: string; publishedAt: string | null; excerpt: string };
export type MemoryAssessment = { verdict: "repeat" | "update" | "new" | "uncertain"; referenceIds: string[]; change: string };
export type RagAudit = { version: 1; status: "disabled" | "retrieved" | "empty" | "unavailable"; documents: MemoryDocument[]; assessment?: MemoryAssessment | null };
const STOP = new Set(["برای", "است", "این", "های", "شود", "شده", "کرد", "خبر", "درباره", "اعلام", "گفت", "بانک"]);
function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[يى]/g,"ی").replace(/ك/g,"ک").replace(/[\u064B-\u065F\u0670\u200c]/g, "").split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 3 && !STOP.has(t)));
}
export function selectMemory(query: string, candidates: MemoryDocument[], maxDocuments = 3): MemoryDocument[] {
  const terms = tokens(query);
  if (terms.size < 2) return [];
  const seen = new Set<string>();
  return candidates.map(doc => {
    const words = tokens(doc.title + " " + doc.excerpt);
    const matches = [...terms].filter(word => words.has(word)).length;
    return { doc, matches, score: matches / Math.sqrt(Math.max(1, terms.size * words.size)) };
  }).filter(row => row.matches >= 2 && row.score >= .15)
    .sort((a,b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
    .filter(({doc}) => { const key = doc.url || doc.id; if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, Math.max(1, Math.min(3, maxDocuments)))
    .map(({doc}) => ({id:doc.id, title:doc.title.slice(0,180),source:doc.source.slice(0,80),url:doc.url.slice(0,500),publishedAt:doc.publishedAt,excerpt:doc.excerpt.slice(0,400)}));
}
export function parseMemoryAssessment(rawText: string, documents: MemoryDocument[]): MemoryAssessment {
  const uncertain: MemoryAssessment = {verdict:"uncertain",referenceIds:[],change:""};
  try {
    const raw = JSON.parse(rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")).memory;
    if (!raw || !["repeat","update","new","uncertain"].includes(raw.verdict) || !Array.isArray(raw.referenceIds) || typeof raw.change !== "string") return uncertain;
    const ids = new Set(documents.map(doc => doc.id));
    if (raw.referenceIds.some((id: unknown) => typeof id !== "string" || !ids.has(id))) return uncertain;
    if (["repeat","update"].includes(raw.verdict) && (!raw.referenceIds.length || !raw.change.trim())) return uncertain;
    return {verdict:raw.verdict, referenceIds:[...new Set<string>(raw.referenceIds)].slice(0,3),change:raw.change.trim().slice(0,400)};
  } catch { return uncertain; }
}
