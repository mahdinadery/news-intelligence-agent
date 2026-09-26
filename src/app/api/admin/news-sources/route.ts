import { checkAdminAccess } from "@/lib/admin/access";
import { diagnoseDbError } from "@/lib/admin/db-errors";
import {
  createSource,
  listRecentRuns,
  listSourcesForAdmin,
  SourceInputError,
  summarizeSources,
} from "@/lib/news/sources-service";
import type { SourceInput } from "@/lib/news/sources-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/news-sources
 * Sources (with health), recent ingestion runs and summary counters.
 */
export async function GET(request: Request) {
  const access = checkAdminAccess(request);
  if (!access.authorized) {
    return Response.json({ success: false, message: access.reason }, { status: 401 });
  }

  try {
    const [sources, runs] = await Promise.all([listSourcesForAdmin(), listRecentRuns(25)]);
    return Response.json({ success: true, sources, runs, summary: summarizeSources(sources) });
  } catch (error) {
    console.error("[news-sources] list failed:", (error instanceof Error ? error.message : String(error)).slice(0, 200));
    // Surface the REAL cause (missing table / unreachable DB / ...) instead of
    // the old opaque generic message that made root-cause analysis impossible.
    const diagnosis = diagnoseDbError(error);
    return Response.json(
      {
        success: false,
        message: "خطا در بارگذاری فهرست منابع.",
        detail: diagnosis.detail,
        hint: diagnosis.hint,
      },
      { status: diagnosis.status },
    );
  }
}

/** POST /api/admin/news-sources — register a new source. */
export async function POST(request: Request) {
  const access = checkAdminAccess(request);
  if (!access.authorized) {
    return Response.json({ success: false, message: access.reason }, { status: 401 });
  }

  let body: Partial<SourceInput>;
  try {
    body = (await request.json()) as Partial<SourceInput>;
  } catch {
    return Response.json({ success: false, message: "بدنه درخواست JSON معتبر نیست." }, { status: 400 });
  }

  try {
    const created = await createSource(body);
    return Response.json({ success: true, source: created }, { status: 201 });
  } catch (error) {
    if (error instanceof SourceInputError) {
      return Response.json({ success: false, message: "اعتبارسنجی منبع ناموفق بود.", errors: error.errors }, { status: 400 });
    }
    console.error("[news-sources] create failed:", (error instanceof Error ? error.message : String(error)).slice(0, 200));
    const diagnosis = diagnoseDbError(error);
    return Response.json(
      {
        success: false,
        message: "ثبت منبع در پایگاه داده ناموفق بود.",
        detail: diagnosis.detail,
        hint: diagnosis.hint,
      },
      { status: diagnosis.status },
    );
  }
}
