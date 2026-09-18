import { maybeRunAutoSend } from "@/lib/agent/auto-hook";
import { ingestNews } from "@/lib/news/ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/news/fetch
 *
 * Dashboard -> this route -> news service -> RSS source -> PostgreSQL.
 * Fetching is explicit (button-driven) and performs NO delivery to Bale.
 */
export async function POST() {
  try {
    const result = await ingestNews();

    if (result.ok) {
      // Catch-up pass: newly fetched items are not analyzed yet, but previously
      // analyzed ones that match the rule get delivered now. Never breaks fetch.
      const autoSend = await maybeRunAutoSend();

      return Response.json({
        success: true,
        source: result.source,
        fetched: result.fetched,
        stored: result.stored,
        duplicates: result.duplicates,
        skipped: result.skipped,
        autoSend,
      });
    }

    // Handled failure: 200 + success:false keeps the client contract simple.
    return Response.json({
      success: false,
      code: result.code,
      message: result.message,
      detail: result.detail ?? null,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[news-fetch] unexpected error:", detail.slice(0, 200));

    return Response.json(
      {
        success: false,
        code: "unknown_error",
        message: "Unexpected error while fetching news.",
        detail: null,
      },
      { status: 500 },
    );
  }
}
