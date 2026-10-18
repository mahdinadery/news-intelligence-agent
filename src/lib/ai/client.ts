/**
 * Server-side AI Client — SERVER-SIDE ONLY.
 *
 * Keeps API keys completely secure by reading them only inside execution scopes
 * (see src/lib/ai/completion.ts for the actual fetch call).
 *
 * Milestone 5: the prompt, model, temperature, max tokens and expected output
 * schema all come from an `ActiveAiConfig` (AI Configuration Center) instead of
 * being hard-coded here. Only the secret (`AI_API_KEY`) stays in the
 * environment — see src/lib/ai/config-service.ts for how the configuration
 * itself is stored/edited, and src/lib/ai/prompt-builder.ts for how it becomes
 * prompt text.
 */

import { BASELINE_BLOCKED_KEYWORDS } from "@/lib/news/topic-filter";
import { buildAIAnalysisPrompt, type ArticleInput } from "./prompt-builder";
import { parseAiOutput, type ParsedAiOutput } from "./output-parser";
import { callAiChatCompletion, resolveEffectiveModel, type CompletionErrorKind } from "./completion";
import type { ActiveAiConfig } from "./config-types";

export type AiAnalysisOutput = ParsedAiOutput;

export type AiErrorKind = CompletionErrorKind | "invalid_json";

export type AiAnalysisResult =
  | { ok: true; analysis: AiAnalysisOutput; promptUsed: { systemPrompt: string; userPrompt: string }; model: string }
  | { ok: false; kind: AiErrorKind; message: string; detail?: string | null };

/** Check if the AI provider has been configured. */
export function isAiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY?.trim());
}

export { resolveEffectiveModel };

/**
 * Call the AI model to analyze a single news article, using the given
 * configuration (Provider/Model/Temperature/Prompt/Features/Decision Rules/
 * Output Schema). `config` is normally the currently active configuration
 * (`getActiveAiConfig()`), but the admin "Test Configuration" panel can pass an
 * unsaved draft here too, since this function never persists anything itself.
 */
export async function runAiAnalysis(
  article: ArticleInput,
  config: Pick<
    ActiveAiConfig,
    | "systemPrompt"
    | "audienceFocus"
    | "features"
    | "decisionRules"
    | "outputSchema"
    | "model"
    | "temperature"
    | "maxTokens"
    | "topicFilter"
  >,
): Promise<AiAnalysisResult> {
  // BASELINE_BLOCKED_KEYWORDS lives in topic-filter.ts (matching side); passing
  // it in keeps prompt-builder.ts dependency-free for the Node test runner.
  const { systemPrompt, userPrompt } = buildAIAnalysisPrompt(config, article, {
    baselineBlockedKeywords: BASELINE_BLOCKED_KEYWORDS,
  });

  const completion = await callAiChatCompletion({
    systemPrompt,
    userPrompt,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  });

  if (!completion.ok) {
    return { ok: false, kind: completion.kind, message: completion.message, detail: completion.detail };
  }

  try {
    const analysis = parseAiOutput(completion.rawText, config.outputSchema);
    return { ok: true, analysis, promptUsed: { systemPrompt, userPrompt }, model: completion.model };
  } catch (parseError) {
    return {
      ok: false,
      kind: "invalid_json",
      message: "پاسخ هوش مصنوعی قالب ساختاریافته (JSON) معتبر نداشت.",
      detail: parseError instanceof Error ? parseError.message : String(parseError),
    };
  }
}
