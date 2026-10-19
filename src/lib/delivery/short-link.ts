/**
 * Self-hosted short links for delivery messages — SERVER-SIDE ONLY.
 *
 * Messages leave the product with `/s/<slug>` links instead of long source
 * URLs; the public `src/app/s/[slug]/route.ts` redirects to the original and
 * counts clicks. Everything is best-effort: a short-link hiccup NEVER blocks
 * a delivery — callers fall back to the original URL.
 *
 * Base URL resolution: SHORT_LINK_BASE_URL → APP_URL → RENDER_EXTERNAL_URL →
 * the known production host (so short links work out of the box on Render).
 */

import { db } from "@/db";
import { shortLinks } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { slugForUrl } from "./slug";

const FALLBACK_BASE_URL = "https://news-intelligence-agent.onrender.com";

export function shortLinkBaseUrl(): string {
  const raw = (
    process.env.SHORT_LINK_BASE_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    FALLBACK_BASE_URL
  ).trim();
  return raw.replace(/\/+$/, "");
}

function shortUrlFor(slug: string): string {
  return `${shortLinkBaseUrl()}/s/${slug}`;
}

async function findSlugByUrl(url: string): Promise<string | null> {
  const [row] = await db.select({ slug: shortLinks.slug }).from(shortLinks).where(eq(shortLinks.url, url)).limit(1);
  return row?.slug ?? null;
}

/**
 * Returns the short form of one URL (creating the mapping on first use), or
 * null when shortening is unavailable — callers then keep the original URL.
 */
export async function ensureShortLink(url: string): Promise<string | null> {
  const clean = (url ?? "").trim();
  if (!/^https?:\/\//i.test(clean)) return null;
  try {
    const existing = await findSlugByUrl(clean);
    if (existing) return shortUrlFor(existing);
    // Deterministic slug; salted retries only for the rare slug collision.
    for (const salt of ["", "r1", "r2"]) {
      const slug = slugForUrl(clean, salt);
      await db.insert(shortLinks).values({ slug, url: clean }).onConflictDoNothing();
      const stored = await findSlugByUrl(clean);
      if (stored) return shortUrlFor(stored);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Shortens a batch of URLs into a lookup map keyed by the EXACT input string
 * (so callers can resolve without re-trimming).
 */
export async function ensureShortLinks(urls: Iterable<string>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const url of new Set([...urls].filter((entry) => typeof entry === "string" && entry.trim()))) {
    const short = await ensureShortLink(url);
    if (short) map.set(url, short);
  }
  return map;
}

/** Builds a `linkFor` callback for the pure message builders. */
export function linkResolver(map: Map<string, string>): (url: string) => string {
  return (url) => map.get(url) ?? url;
}

/** Resolves a slug to its target URL and records the click (best-effort). */
export async function resolveShortLink(slug: string): Promise<string | null> {
  const clean = (slug ?? "").trim();
  if (!clean) return null;
  try {
    const [row] = await db.select().from(shortLinks).where(eq(shortLinks.slug, clean)).limit(1);
    if (!row) return null;
    await db
      .update(shortLinks)
      .set({ clickCount: sql`${shortLinks.clickCount} + 1`, lastClickedAt: new Date() })
      .where(eq(shortLinks.slug, clean));
    return row.url;
  } catch {
    return null;
  }
}
