import { maybeRunAutoSend } from "@/lib/agent/auto-hook";
import { analyzeArticle } from "@/lib/news/analyze";
import { ingestNews } from "@/lib/news/ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/news/fetch
 *
 * Dashboard -> this route -> news service -> RSS source -> PostgreSQL.
 * Fetching is explicit (button-driven).
 */
export async function POST() {
  try {
    const result = await ingestNews();

    if (result.ok) {
      // Analyze every newly stored article before evaluating the auto-send rule.
      // One failed AI analysis must not prevent the other articles from processing.
      const analysisResults = [];

      for (const id of result.newArticleIds) {
        try {
          const analysis = await analyzeArticle(id);

          analysisResults.push({
            id,
            ok: analysis.ok,
            code: analysis.ok ? null : analysis.code,
            message: analysis.ok ? null : analysis.message,
            detail: analysis.ok ? null : (analysis.detail ?? null),
          });
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);

          console.error(
            "[news-fetch] article analysis failed:",
            detail.slice(0, 200),
          );

          analysisResults.push({
            id,
            ok: false,
            code: "analysis_error",
            message: detail,
            detail: null,
          });
        }
      }

      // Now that newly fetched articles have been analyzed, evaluate the
      // auto-send rule only against those new articles.
      const autoSend = await maybeRunAutoSend(result.newArticleIds);

      return Response.json({
        success: true,
        source: result.source,
        fetched: result.fetched,
        stored: result.stored,
        newArticleIds: result.newArticleIds,
        analyzed: analysisResults,
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

    console.error(
      "[news-fetch] unexpected error:",
      detail.slice(0, 200),
    );

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
