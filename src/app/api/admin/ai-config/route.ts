import { checkAdminAccess } from "@/lib/admin/access";
import { diagnoseDbError } from "@/lib/admin/db-errors";
import { isAiConfigured, resolveEffectiveModel } from "@/lib/ai/client";
import { createAiConfigVersion, getActiveAiConfig, validateAiConfigInput } from "@/lib/ai/config-service";
import type { AiConfigInput } from "@/lib/ai/config-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ai-config
 *
 * Returns the currently active AI configuration. Creates the default
 * configuration automatically the first time this is called, so existing AI
 * analysis behavior is preserved even if nobody has opened the admin page yet.
 * Never returns API secrets (there are none in this table — only prompt/model
 * name/thresholds/schema, all non-secret operational data).
 */
export async function GET(request: Request) {
  const access = checkAdminAccess(request);
  if (!access.authorized) {
    return Response.json({ success: false, message: access.reason }, { status: 401 });
  }

  try {
    const config = await getActiveAiConfig();
    return Response.json({
      success: true,
      config,
      // Non-secret operational status: whether AI_API_KEY is set, and which
      // model will actually be used given the config + env fallback chain.
      aiKeyConfigured: isAiConfigured(),
      effectiveModel: resolveEffectiveModel(config.model),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[ai-config] failed to load active config:", detail.slice(0, 200));
    const diagnosis = diagnoseDbError(error);
    return Response.json(
      {
        success: false,
        message: "خطا در بارگذاری پیکربندی هوش مصنوعی از پایگاه داده.",
        detail: diagnosis.detail,
        hint: diagnosis.hint,
      },
      { status: diagnosis.status },
    );
  }
}

type SaveBody = AiConfigInput & { activate?: boolean };

/**
 * POST /api/admin/ai-config
 *
 * Saves a NEW version of the configuration (append-only history — the previous
 * version is preserved, never overwritten). `activate` defaults to true
 * ("Save & Activate"); pass `activate: false` to save a draft without making it
 * live ("Save Configuration").
 */
export async function POST(request: Request) {
  const access = checkAdminAccess(request);
  if (!access.authorized) {
    return Response.json({ success: false, message: access.reason }, { status: 401 });
  }

  let body: SaveBody;
  try {
    body = (await request.json()) as SaveBody;
  } catch {
    return Response.json({ success: false, message: "بدنه درخواست JSON معتبر نیست." }, { status: 400 });
  }

  const input: AiConfigInput = {
    name: body.name,
    provider: "openai-compatible",
    model: body.model ?? "",
    systemPrompt: body.systemPrompt,
    temperature: body.temperature,
    maxTokens: body.maxTokens,
    features: body.features,
    decisionRules: body.decisionRules,
    outputSchema: body.outputSchema,
    publishingTemplate: body.publishingTemplate ?? "",
    topicFilter: body.topicFilter,
    autoSendPolicy: body.autoSendPolicy,
  };

  const validation = validateAiConfigInput(input);
  if (!validation.valid) {
    return Response.json({ success: false, message: "پیکربندی نامعتبر است.", errors: validation.errors }, { status: 400 });
  }

  try {
    const activate = body.activate !== false;
    const config = await createAiConfigVersion(input, { activate });
    return Response.json({
      success: true,
      config,
      aiKeyConfigured: isAiConfigured(),
      effectiveModel: resolveEffectiveModel(config.model),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[ai-config] failed to save config:", detail.slice(0, 200));
    const diagnosis = diagnoseDbError(error);
    return Response.json(
      {
        success: false,
        message: "ذخیره پیکربندی در پایگاه داده ناموفق بود.",
        detail: diagnosis.detail,
        hint: diagnosis.hint,
      },
      { status: diagnosis.status },
    );
  }
}
