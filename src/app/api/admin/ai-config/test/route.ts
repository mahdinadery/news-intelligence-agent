import { checkAdminAccess } from "@/lib/admin/access";
import { callAiChatCompletion } from "@/lib/ai/completion";
import { getActiveAiConfig, validateAiConfigInput } from "@/lib/ai/config-service";
import type { AiConfigInput } from "@/lib/ai/config-types";
import { BASELINE_BLOCKED_KEYWORDS } from "@/lib/news/topic-filter";
import { buildAIAnalysisPrompt } from "@/lib/ai/prompt-builder";
import { validateAiOutputAgainstSchema } from "@/lib/ai/output-parser";
import { db } from "@/db";
import { news } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ai-config/test
 *
 * Lightweight article list (id/title/source/analyzed flag) for the "Test
 * Configuration" article selector dropdown. Read-only.
 */
export async function GET(request: Request) {
  const access = checkAdminAccess(request);
  if (!access.authorized) {
    return Response.json({ success: false, message: access.reason }, { status: 401 });
  }

  const rows = await db
    .select({
      id: news.id,
      title: news.title,
      source: news.source,
      analyzedAt: news.analyzedAt,
    })
    .from(news)
    .orderBy(desc(sql`coalesce(${news.publishedAt}, ${news.createdAt})`))
    .limit(50);

  return Response.json({
    success: true,
    articles: rows.map((row) => ({
      id: row.id,
      title: row.title,
      source: row.source,
      analyzed: Boolean(row.analyzedAt),
    })),
  });
}

type ManualArticle = {
  title: string;
  description: string | null;
  source: string;
  publishedAt: string | null;
};

type TestBody = {
  /** Optional unsaved draft configuration to test before saving it. */
  draftConfig?: AiConfigInput;
  /** Pick an existing stored article by ID (read-only — never modified). */
  articleId?: string;
  /** Or paste/describe an article manually. */
  manualArticle?: ManualArticle;
};

/**
 * POST /api/admin/ai-config/test
 *
 * Runs the (draft or active) configuration against one article WITHOUT ever
 * sending anything to Bale/Local and WITHOUT writing to the `news` table
 * (article rows are only ever read here, never updated).
 *
 * Returns: the exact prompt used, the raw AI response text, the schema
 * validation result, and — when valid — the parsed structured result.
 */
export async function POST(request: Request) {
  const access = checkAdminAccess(request);
  if (!access.authorized) {
    return Response.json({ success: false, message: access.reason }, { status: 401 });
  }

  let body: TestBody;
  try {
    body = (await request.json()) as TestBody;
  } catch {
    return Response.json({ success: false, message: "بدنه درخواست JSON معتبر نیست." }, { status: 400 });
  }

  // Resolve the configuration to test: an unsaved draft, or the active one.
  let configForPrompt: AiConfigInput;

  if (body.draftConfig) {
    const validation = validateAiConfigInput(body.draftConfig);
    if (!validation.valid) {
      return Response.json(
        { success: false, message: "پیکربندی آزمایشی نامعتبر است.", errors: validation.errors },
        { status: 400 },
      );
    }
    configForPrompt = body.draftConfig;
  } else {
    const active = await getActiveAiConfig();
    configForPrompt = active;
  }

  // Resolve the article: an existing stored row (read-only) or a manual/pasted one.
  let article: ManualArticle;

  if (body.articleId) {
    const [row] = await db
      .select({
        title: news.title,
        description: news.description,
        source: news.source,
        publishedAt: news.publishedAt,
      })
      .from(news)
      .where(eq(news.id, body.articleId))
      .limit(1);

    if (!row) {
      return Response.json({ success: false, message: "خبر انتخاب‌شده پیدا نشد." }, { status: 404 });
    }

    article = {
      title: row.title,
      description: row.description,
      source: row.source,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    };
  } else if (body.manualArticle?.title?.trim()) {
    article = {
      title: body.manualArticle.title.trim(),
      description: body.manualArticle.description?.trim() || null,
      source: body.manualArticle.source?.trim() || "تست دستی",
      publishedAt: body.manualArticle.publishedAt?.trim() || null,
    };
  } else {
    return Response.json(
      { success: false, message: "یک خبر موجود را انتخاب کنید یا متن خبر آزمایشی را وارد کنید." },
      { status: 400 },
    );
  }

  const { systemPrompt, userPrompt } = buildAIAnalysisPrompt(configForPrompt, article, {
    baselineBlockedKeywords: BASELINE_BLOCKED_KEYWORDS,
  });

  const completion = await callAiChatCompletion({
    systemPrompt,
    userPrompt,
    model: configForPrompt.model,
    temperature: configForPrompt.temperature,
    maxTokens: configForPrompt.maxTokens,
  });

  if (!completion.ok) {
    return Response.json({
      success: false,
      message: completion.message,
      detail: completion.detail ?? null,
      promptUsed: { systemPrompt, userPrompt },
    });
  }

  const validation = validateAiOutputAgainstSchema(completion.rawText, configForPrompt.outputSchema);

  return Response.json({
    success: true,
    model: completion.model,
    promptUsed: { systemPrompt, userPrompt },
    rawResponse: completion.rawText,
    validation:
      validation.ok
        ? { valid: true, issues: validation.issues, parsed: validation.value }
        : { valid: false, issues: validation.issues, parsed: null },
  });
}
