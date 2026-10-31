import { db } from "@/db";
import { news } from "@/db/schema";
import { and, desc, gte, lte, ne, sql } from "drizzle-orm";
import { selectMemory, type RagAudit } from "../ai/rag-memory";

/** No schema extension or provider request; read at most 200 previous articles. */
export async function retrieveNewsMemory(input: { id?: string; title: string; description: string | null; before: Date; publishedAt?: string | null }, enabled: boolean): Promise<RagAudit> {
  if (!enabled) return {version:1,status:"disabled",documents:[]};
  try {
    const cutoff = input.publishedAt && Number.isFinite(Date.parse(input.publishedAt))
      ? new Date(Math.min(input.before.getTime(),Date.parse(input.publishedAt))) : input.before;
    const rows = await db.select({id:news.id,title:news.title,source:news.source,url:news.url,publishedAt:news.publishedAt,description:news.description})
      .from(news).where(and(
        input.id ? ne(news.id,input.id) : undefined,
        lte(news.createdAt,input.before),
        lte(sql`coalesce(${news.publishedAt}, ${news.createdAt})`,cutoff),
        gte(sql`coalesce(${news.publishedAt}, ${news.createdAt})`,new Date(cutoff.getTime()-30*86400000)),
        sql`${news.status} NOT IN ('DUPLICATE', 'FAILED', 'SKIPPED_OFFTOPIC')`,
      )).orderBy(desc(news.createdAt)).limit(200);
    const documents = selectMemory(input.title + " " + (input.description ?? "").slice(0,1000),rows.map(row => ({...row,publishedAt:row.publishedAt?.toISOString() ?? null,excerpt:row.description ?? ""})));
    return {version:1,status:documents.length ? "retrieved" : "empty",documents};
  } catch (error) {
    console.error("[rag] retrieval unavailable:", error instanceof Error ? error.name : "unknown");
    return {version:1,status:"unavailable",documents:[]};
  }
}
