/**
 * Public short-link redirect — one hop from `/s/<slug>` to the original
 * source URL. Slugs only exist for URLs the product itself shortened (the
 * mapping is created by the delivery pipeline, never by public input), so
 * this cannot be abused as an open redirecter.
 */

import { resolveShortLink } from "@/lib/delivery/short-link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const target = await resolveShortLink(decodeURIComponent(slug ?? ""));
  if (!target) {
    return new Response("لینک کوتاه یافت نشد.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  // 302 (not 301) so a mapping can be repaired later without browser caching.
  return Response.redirect(target, 302);
}
