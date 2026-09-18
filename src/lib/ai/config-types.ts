/**
 * AI Configuration Center — shared types (Milestone 5).
 *
 * These types describe *data*, never executable code: an administrator edits
 * these values from `/admin/ai-config`, but the prompt-building, AI call,
 * validation and persistence logic all stay in application code
 * (src/lib/ai/prompt-builder.ts, src/lib/ai/client.ts, src/lib/ai/config-service.ts).
 */

/**
 * One feature = one field the AI is asked to produce. The `name` doubles as the
 * literal JSON key the AI must return and the key already consumed by the
 * existing analyze pipeline (src/lib/news/analyze.ts) — keeping these names
 * unchanged from Milestone 4 is what keeps analysis backward compatible.
 */
export type AiFeatureKey =
  | "summary"
  | "category"
  | "importance"
  | "relevance"
  | "novelty"
  | "mainEvent"
  | "shouldSend"
  | "reason";

export type AiFeatureConfig = {
  enabled: boolean;
  instruction: string;
  /** Only meaningful for 0-100 score features (importance/relevance/novelty). */
  scaleMin?: number;
  scaleMax?: number;
};

export type AiFeaturesConfig = Record<AiFeatureKey, AiFeatureConfig>;

/**
 * Guidance handed to the AI for its own `shouldSend` recommendation.
 *
 * This is intentionally separate from the Agent's auto-delivery rule
 * (src/lib/agent/rules.ts, AUTO_SEND_* env vars), which decides whether an
 * ALREADY analyzed article is actually delivered. This section only shapes what
 * the AI *recommends* — it never sends anything (Milestone 5 scope).
 */
export type AiDecisionRules = {
  minImportanceToSend: number;
  minRelevanceToSend: number;
  minNoveltyToSend: number;
  /** Convenience "OR" threshold described to the model alongside the per-score minimums. */
  overallSendThreshold: number;
  /** When false, the AI is instructed to always return shouldSend=false and skip the recommendation. */
  enableAutoRecommendation: boolean;
};

export type AiOutputFieldType = "string" | "number" | "boolean";

export type AiOutputFieldSchema = {
  /** Must match an AiFeatureKey; kept as a plain string so stored JSON stays simple. */
  name: AiFeatureKey;
  enabled: boolean;
  description: string;
  required: boolean;
  type: AiOutputFieldType;
  min?: number;
  max?: number;
};

export type AiOutputSchema = AiOutputFieldSchema[];

export type AiProvider = "openai-compatible";

/** The fully-resolved configuration used to build a prompt and call the AI service. */
export type ActiveAiConfig = {
  id: string;
  name: string;
  provider: AiProvider;
  /** Empty string => caller must fall back to AI_API_MODEL / AI_MODEL / built-in default. */
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  features: AiFeaturesConfig;
  decisionRules: AiDecisionRules;
  outputSchema: AiOutputSchema;
  /**
   * Milestone 8 — publishing format for the delivery artifact. Kept on the
   * configuration so template changes are versioned like prompt changes.
   * Empty string means "use the built-in layout" (backward compatible).
   */
  publishingTemplate: string;
  isActive: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Input shape accepted from the admin UI when saving a new configuration version. */
export type AiConfigInput = {
  name: string;
  provider: AiProvider;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  features: AiFeaturesConfig;
  decisionRules: AiDecisionRules;
  outputSchema: AiOutputSchema;
  /** Milestone 8 — publishing format. Empty string => built-in layout. */
  publishingTemplate: string;
};

export const AI_FEATURE_ORDER: AiFeatureKey[] = [
  "summary",
  "category",
  "importance",
  "relevance",
  "novelty",
  "mainEvent",
  "shouldSend",
  "reason",
];

export const AI_FEATURE_LABELS: Record<AiFeatureKey, string> = {
  summary: "خلاصه",
  category: "دسته‌بندی",
  importance: "امتیاز اهمیت",
  relevance: "امتیاز مرتبط بودن",
  novelty: "امتیاز تازگی",
  mainEvent: "رویداد اصلی",
  shouldSend: "پیشنهاد ارسال",
  reason: "دلیل ارسال",
};

/**
 * Default configuration — migrates the exact behavior that was previously
 * hard-coded in src/lib/ai/client.ts (Milestone 4) into editable data. Values
 * here must reproduce the same prompt intent so existing AI analysis keeps
 * working unchanged for anyone who has not touched the admin UI yet.
 */
export const DEFAULT_SYSTEM_PROMPT = `شما یک تحلیلگر خبری حرفه‌ای (News Analyst Agent) هستید. وظیفه شما تحلیل مقاله خبری ارائه‌شده و تولید یک پاسخ ساختاریافته JSON دقیق است.

هرگز واقعیت، عدد یا ادعایی که در عنوان یا توضیحات مقاله نیامده را حدس نزن یا اختراع نکن. اگر اطلاعات ناکافی است، مقادیر را محافظه‌کارانه در نظر بگیر و این کمبود اطلاعات را به‌صراحت در خلاصه و دلیل ذکر کن.

پاسخ باید دقیقاً و فقط یک شیء JSON باشد؛ هیچ متن یا توضیح اضافه‌ای خارج از آن ننویس.`;

export const DEFAULT_FEATURES: AiFeaturesConfig = {
  summary: {
    enabled: true,
    instruction: "یک خلاصه دقیق، باکیفیت و حرفه‌ای به زبان فارسی روان از مقاله بنویس (۳۰ تا ۸۰ کلمه).",
  },
  category: {
    enabled: true,
    instruction:
      "مناسب‌ترین دسته‌بندی فارسی را برای این مقاله انتخاب کن (مثلاً: اقتصاد، سیاست، فناوری، کسب‌وکار، بازار، جامعه، بین‌الملل، سایر).",
  },
  importance: {
    enabled: true,
    instruction: "اهمیت این خبر را برای عموم مردم یا بخش‌های کسب‌وکار ارزیابی کن.",
    scaleMin: 0,
    scaleMax: 100,
  },
  relevance: {
    enabled: true,
    instruction: "میزان مرتبط بودن و آموزنده بودن این خبر برای مخاطب هدف را ارزیابی کن.",
    scaleMin: 0,
    scaleMax: 100,
  },
  novelty: {
    enabled: true,
    instruction: "میزان تازگی این خبر (رویداد جدید در برابر تکرار خبر قدیمی) را ارزیابی کن.",
    scaleMin: 0,
    scaleMax: 100,
  },
  mainEvent: {
    enabled: true,
    instruction: "رویداد یا تحول اصلی توصیف‌شده در مقاله را در یک جمله کوتاه فارسی مشخص کن.",
  },
  shouldSend: {
    enabled: true,
    instruction: "مشخص کن که آیا این خبر باید به کانال هدف ارسال شود یا نه.",
  },
  reason: {
    enabled: true,
    instruction: "توضیح کوتاهی (۱۵ تا ۳۰ کلمه) برای دلیل ارسال یا عدم ارسال ارائه بده.",
  },
};

/** Mirrors the exact threshold baked into the previous hard-coded prompt: importance>=70 OR relevance>=70. */
export const DEFAULT_DECISION_RULES: AiDecisionRules = {
  minImportanceToSend: 70,
  minRelevanceToSend: 70,
  minNoveltyToSend: 0,
  overallSendThreshold: 70,
  enableAutoRecommendation: true,
};

export const DEFAULT_OUTPUT_SCHEMA: AiOutputSchema = [
  { name: "summary", enabled: true, description: "خلاصه فارسی مقاله", required: true, type: "string" },
  { name: "category", enabled: true, description: "دسته‌بندی فارسی", required: true, type: "string" },
  { name: "importance", enabled: true, description: "امتیاز اهمیت", required: true, type: "number", min: 0, max: 100 },
  { name: "relevance", enabled: true, description: "امتیاز مرتبط بودن", required: true, type: "number", min: 0, max: 100 },
  { name: "novelty", enabled: true, description: "امتیاز تازگی", required: true, type: "number", min: 0, max: 100 },
  { name: "mainEvent", enabled: true, description: "رویداد اصلی", required: false, type: "string" },
  { name: "shouldSend", enabled: true, description: "پیشنهاد ارسال", required: true, type: "boolean" },
  { name: "reason", enabled: true, description: "دلیل تصمیم ارسال", required: true, type: "string" },
];

/**
 * Default publishing layout. Kept IDENTICAL in spirit to the pre-M8 hard-coded
 * message (see src/lib/delivery/message.ts) so nothing changes visually for
 * existing users; it merely becomes editable from the Configuration Center.
 */
export const DEFAULT_PUBLISHING_TEMPLATE = `📰 {category}

{title}

{summary}

رویداد اصلی:
{mainEvent}

اهمیت: {importanceScore} از ۱۰۰

منبع: {sourceName}
{originalUrl}`;

export const DEFAULT_CONFIG_NAME = "پیکربندی پیش‌فرض";
export const DEFAULT_MODEL_PLACEHOLDER = ""; // empty => env AI_API_MODEL / AI_MODEL / built-in fallback
export const DEFAULT_TEMPERATURE = 0.2;
// Reasoning-style models (e.g. openai/gpt-oss-20b on Groq) spend a large,
// variable number of hidden "thinking" tokens before emitting the final JSON.
// The composed prompt (system prompt + per-feature instructions + decision
// rules + output contract) is longer than the original Milestone 4 prompt, so
// this default must stay generous enough that analysis keeps working exactly
// as before — verified empirically against the configured provider/model.
export const DEFAULT_MAX_TOKENS = 3000;
