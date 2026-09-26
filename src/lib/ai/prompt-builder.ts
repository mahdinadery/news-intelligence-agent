/**
 * AI Configuration Center — prompt construction (Milestone 5).
 *
 * Single reusable place where a stored/draft configuration is turned into the
 * text actually sent to the AI provider:
 *
 *   System Prompt + Enabled Analysis Features + Decision Rules + Output Schema
 *   + Article Content
 *
 * Both the production analysis pipeline (src/lib/news/analyze.ts) and the admin
 * "Test Configuration" panel call this same function, so there is exactly one
 * place that knows how a configuration becomes a prompt.
 */

import { describeTopicFocus } from "@/lib/news/topic-filter";
import {
  AI_FEATURE_ORDER,
  type AiDecisionRules,
  type AiFeaturesConfig,
  type AiOutputSchema,
  type AiTopicFilterConfig,
} from "./config-types";

export type PromptableConfig = {
  systemPrompt: string;
  features: AiFeaturesConfig;
  decisionRules: AiDecisionRules;
  outputSchema: AiOutputSchema;
  /** Optional topic focus — injected as context so relevance judgments align with it. */
  topicFilter?: AiTopicFilterConfig | null;
};

export type ArticleInput = {
  title: string;
  description: string | null;
  source: string;
  publishedAt: string | null;
};

function describeType(type: "string" | "number" | "boolean", min?: number, max?: number): string {
  if (type === "boolean") return "boolean (true|false)";
  if (type === "number") return `number${min !== undefined && max !== undefined ? ` (${min}-${max})` : ""}`;
  return "string";
}

/**
 * Builds the JSON-shape instructions the model must follow, from only the
 * fields that are simultaneously enabled as a feature AND enabled in the
 * output schema. Disabled fields are omitted entirely from the contract.
 */
function buildOutputContract(config: PromptableConfig): { template: string; enabledFields: string[] } {
  const lines: string[] = [];
  const enabledFields: string[] = [];

  for (const key of AI_FEATURE_ORDER) {
    const feature = config.features[key];
    const schemaField = config.outputSchema.find((field) => field.name === key);

    if (!feature?.enabled || !schemaField?.enabled) continue;

    enabledFields.push(key);
    const typeHint = describeType(schemaField.type, schemaField.min, schemaField.max);
    const requiredHint = schemaField.required ? "الزامی" : "اختیاری";
    lines.push(`  "${key}": ${typeHint} — ${requiredHint} — ${feature.instruction}`);
  }

  return { template: lines.join("\n"), enabledFields };
}

function buildDecisionRulesSection(config: PromptableConfig): string {
  const shouldSendEnabled = config.features.shouldSend?.enabled && config.decisionRules.enableAutoRecommendation;

  if (!shouldSendEnabled) {
    return "«shouldSend» را همیشه false و «reason» را با ذکر اینکه توصیه ارسال غیرفعال است، برگردان.";
  }

  const rules = config.decisionRules;
  return [
    `«shouldSend» را true قرار بده تنها اگر حداقل یکی از این شرایط برقرار باشد:`,
    `- امتیاز اهمیت (importance) >= ${rules.minImportanceToSend}`,
    `- امتیاز مرتبط بودن (relevance) >= ${rules.minRelevanceToSend}`,
    rules.minNoveltyToSend > 0 ? `- امتیاز تازگی (novelty) >= ${rules.minNoveltyToSend}` : null,
    `به‌عنوان راهنمای کلی، آستانه ترکیبی ارسال حدود ${rules.overallSendThreshold} از ۱۰۰ در نظر گرفته شود.`,
    `در غیر این صورت «shouldSend» را false بگذار و در «reason» توضیح کوتاه بده.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Composes the final { systemPrompt, userPrompt } sent to the AI service.
 * This is the only function in the codebase that turns configuration data into
 * prompt text — keep all future prompt changes here.
 */
export function buildAIAnalysisPrompt(
  config: PromptableConfig,
  article: ArticleInput,
): { systemPrompt: string; userPrompt: string; enabledFields: string[] } {
  const { template, enabledFields } = buildOutputContract(config);
  const decisionSection = buildDecisionRulesSection(config);
  const topicSection = describeTopicFocus(config.topicFilter);

  const systemPrompt = [
    config.systemPrompt.trim(),
    "",
    "دستورالعمل‌های تحلیل (فقط فیلدهای زیر را در خروجی بگنجان):",
    template,
    "",
    "قوانین راهنما برای تصمیم ارسال:",
    decisionSection,
    topicSection ? "" : null,
    topicSection,
    "",
    "پاسخ باید دقیقاً یک شیء JSON معتبر با همان کلیدهای بالا باشد؛ هیچ کلید یا متن اضافه‌ای اضافه نکن.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const userPrompt = [
    "لطفاً این مقاله را تحلیل کن:",
    `عنوان: ${article.title}`,
    `منبع: ${article.source}`,
    `تاریخ انتشار: ${article.publishedAt ?? "نامشخص"}`,
    `توضیحات/محتوا: ${article.description ?? "نامشخص"}`,
  ].join("\n");

  return { systemPrompt, userPrompt, enabledFields };
}
