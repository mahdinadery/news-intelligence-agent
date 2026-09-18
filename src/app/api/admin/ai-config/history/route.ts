import { checkAdminAccess } from "@/lib/admin/access";
import { listAiConfigVersions } from "@/lib/ai/config-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ai-config/history
 *
 * Newest-first list of every saved configuration version, for the "Version
 * History" table in /admin/ai-config. No secrets are stored in this table.
 */
export async function GET(request: Request) {
  const access = checkAdminAccess(request);
  if (!access.authorized) {
    return Response.json({ success: false, message: access.reason }, { status: 401 });
  }

  try {
    const versions = await listAiConfigVersions(50);
    return Response.json({ success: true, versions });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[ai-config-history] failed to load versions:", detail.slice(0, 200));
    return Response.json({ success: false, message: "خطا در بارگذاری تاریخچه نسخه‌ها." }, { status: 500 });
  }
}
