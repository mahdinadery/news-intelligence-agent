/**
 * AI Configuration Center — persistence & versioning (Milestone 5).
 *
 * Single source of truth for reading/writing `ai_configurations`. Every save
 * inserts a brand-new row (append-only history); activating a version simply
 * flips `isActive` off on every other row and on for the chosen one, inside a
 * transaction so exactly one configuration is ever active.
 */

import { db } from "@/db";
import { aiConfigurations, type AiConfigurationRow } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import {
  DEFAULT_CONFIG_NAME,
  DEFAULT_DECISION_RULES,
  DEFAULT_FEATURES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL_PLACEHOLDER,
  DEFAULT_OUTPUT_SCHEMA,
  DEFAULT_PUBLISHING_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE,
  type ActiveAiConfig,
  type AiConfigInput,
  type AiFeatureKey,
} from "./config-types";

function toActiveConfig(row: AiConfigurationRow): ActiveAiConfig {
  return {
    id: row.id,
    name: row.name,
    provider: "openai-compatible",
    model: row.model,
    systemPrompt: row.systemPrompt,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    features: row.features,
    decisionRules: row.decisionRules,
    outputSchema: row.outputSchema,
    publishingTemplate: row.publishingTemplate ?? "",
    isActive: row.isActive,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Builds the seed configuration matching the previous hard-coded AI behavior. */
export function buildDefaultConfigInput(): AiConfigInput {
  return {
    name: DEFAULT_CONFIG_NAME,
    provider: "openai-compatible",
    model: DEFAULT_MODEL_PLACEHOLDER,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    features: DEFAULT_FEATURES,
    decisionRules: DEFAULT_DECISION_RULES,
    outputSchema: DEFAULT_OUTPUT_SCHEMA,
    publishingTemplate: DEFAULT_PUBLISHING_TEMPLATE,
  };
}

/**
 * Returns the active configuration, creating the default one automatically the
 * first time this is called (Milestone 5 backward-compatibility requirement:
 * "If no configuration exists, create the default configuration automatically
 * using the current working AI analysis behavior.").
 */
export async function getActiveAiConfig(): Promise<ActiveAiConfig> {
  const [active] = await db
    .select()
    .from(aiConfigurations)
    .where(eq(aiConfigurations.isActive, true))
    .orderBy(desc(aiConfigurations.version))
    .limit(1);

  if (active) {
    return toActiveConfig(active);
  }

  // No active configuration anywhere yet: seed the default and activate it.
  const seeded = await createAiConfigVersion(buildDefaultConfigInput(), { activate: true });
  return seeded;
}

/** Newest-first version history (id, version, name, isActive, timestamps) — no secrets. */
export async function listAiConfigVersions(limit = 50): Promise<ActiveAiConfig[]> {
  const rows = await db
    .select()
    .from(aiConfigurations)
    .orderBy(desc(aiConfigurations.version))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows.map(toActiveConfig);
}

export async function getAiConfigById(id: string): Promise<ActiveAiConfig | null> {
  const [row] = await db.select().from(aiConfigurations).where(eq(aiConfigurations.id, id)).limit(1);
  return row ? toActiveConfig(row) : null;
}

async function nextVersionNumber(): Promise<number> {
  const [latest] = await db
    .select({ version: aiConfigurations.version })
    .from(aiConfigurations)
    .orderBy(desc(aiConfigurations.version))
    .limit(1);

  return (latest?.version ?? 0) + 1;
}

/**
 * Inserts a new configuration version. When `activate` is true (default),
 * every other row is deactivated first inside the same transaction so exactly
 * one configuration stays active — this is the project's single-active-config
 * policy referenced in the milestone brief.
 */
export async function createAiConfigVersion(
  input: AiConfigInput,
  options: { activate: boolean } = { activate: true },
): Promise<ActiveAiConfig> {
  const version = await nextVersionNumber();

  const created = await db.transaction(async (tx) => {
    if (options.activate) {
      await tx.update(aiConfigurations).set({ isActive: false }).where(eq(aiConfigurations.isActive, true));
    }

    const [row] = await tx
      .insert(aiConfigurations)
      .values({
        name: input.name,
        provider: input.provider,
        model: input.model,
        systemPrompt: input.systemPrompt,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        features: input.features,
        decisionRules: input.decisionRules,
        outputSchema: input.outputSchema,
        publishingTemplate: input.publishingTemplate?.trim() ?? "",
        isActive: options.activate,
        version,
      })
      .returning();

    return row;
  });

  return toActiveConfig(created);
}

/** Activates a previously saved version without editing its content. */
export async function activateAiConfigVersion(id: string): Promise<ActiveAiConfig | null> {
  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(aiConfigurations).where(eq(aiConfigurations.id, id)).limit(1);
    if (!target) return null;

    await tx
      .update(aiConfigurations)
      .set({ isActive: false })
      .where(and(eq(aiConfigurations.isActive, true)));

    const [updated] = await tx
      .update(aiConfigurations)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(aiConfigurations.id, id))
      .returning();

    return toActiveConfig(updated);
  });
}

export type ConfigValidationResult = { valid: true } | { valid: false; errors: string[] };

const REQUIRED_FEATURE_KEYS: AiFeatureKey[] = [
  "summary",
  "category",
  "importance",
  "relevance",
  "novelty",
  "mainEvent",
  "shouldSend",
  "reason",
];

/**
 * Validates a configuration before it is ever sent to the AI service or saved.
 * All messages are Persian, surfaced directly in the admin UI.
 */
export function validateAiConfigInput(input: AiConfigInput): ConfigValidationResult {
  const errors: string[] = [];

  if (!input.systemPrompt || !input.systemPrompt.trim()) {
    errors.push("متن System Prompt نمی‌تواند خالی باشد.");
  }

  if (!input.name || !input.name.trim()) {
    errors.push("نام پیکربندی نمی‌تواند خالی باشد.");
  }

  const featureKeys = REQUIRED_FEATURE_KEYS.filter((key) => input.features?.[key]);
  if (featureKeys.length !== REQUIRED_FEATURE_KEYS.length) {
    errors.push("ساختار ویژگی‌های تحلیل ناقص است.");
  } else {
    const enabledCount = featureKeys.filter((key) => input.features[key].enabled).length;
    if (enabledCount === 0) {
      errors.push("حداقل باید یک ویژگی تحلیل فعال باشد.");
    }

    for (const key of featureKeys) {
      const feature = input.features[key];
      if (feature.enabled && !feature.instruction?.trim()) {
        errors.push(`دستورالعمل ویژگی «${key}» نمی‌تواند خالی باشد.`);
      }
      if (feature.scaleMin !== undefined && feature.scaleMax !== undefined && feature.scaleMin >= feature.scaleMax) {
        errors.push(`بازه امتیاز ویژگی «${key}» نامعتبر است.`);
      }
    }
  }

  if (!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2) {
    errors.push("مقدار Temperature باید عددی بین ۰ و ۲ باشد.");
  }

  if (!Number.isInteger(input.maxTokens) || input.maxTokens < 50 || input.maxTokens > 8000) {
    errors.push("مقدار Max Tokens باید عددی صحیح بین ۵۰ و ۸۰۰۰ باشد.");
  }

  const rules = input.decisionRules;
  if (!rules) {
    errors.push("قوانین تصمیم‌گیری تعریف نشده است.");
  } else {
    for (const [label, value] of [
      ["حداقل امتیاز اهمیت", rules.minImportanceToSend],
      ["حداقل امتیاز مرتبط بودن", rules.minRelevanceToSend],
      ["حداقل امتیاز تازگی", rules.minNoveltyToSend],
      ["آستانه کلی ارسال", rules.overallSendThreshold],
    ] as const) {
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        errors.push(`${label} باید عددی بین ۰ و ۱۰۰ باشد.`);
      }
    }
  }

  if (!Array.isArray(input.outputSchema) || input.outputSchema.length === 0) {
    errors.push("ساختار خروجی (Output Schema) نمی‌تواند خالی باشد.");
  } else {
    const enabledRequired = input.outputSchema.filter((field) => field.enabled && field.required);
    if (enabledRequired.length === 0) {
      errors.push("حداقل یک فیلد الزامی در ساختار خروجی باید فعال باشد.");
    }
    for (const field of input.outputSchema) {
      if (field.type === "number" && field.min !== undefined && field.max !== undefined && field.min >= field.max) {
        errors.push(`بازه عددی فیلد «${field.name}» نامعتبر است.`);
      }
    }
    // Required-but-disabled fields would silently break the existing parser/DB contract.
    const disabledButRequiredByPipeline = input.outputSchema.filter(
      (field) => !field.enabled && (field.name === "summary" || field.name === "shouldSend"),
    );
    if (disabledButRequiredByPipeline.length > 0) {
      errors.push("فیلدهای «summary» و «shouldSend» برای عملکرد صحیح سامانه باید فعال بمانند.");
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
