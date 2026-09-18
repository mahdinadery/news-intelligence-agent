/**
 * Low-level AI chat-completion transport — SERVER-SIDE ONLY.
 *
 * Extracted so both the production analysis pipeline (runAiAnalysis in
 * src/lib/ai/client.ts) and the admin "Test Configuration" panel
 * (src/app/api/admin/ai-config/test/route.ts) can obtain the *raw* AI response
 * text through the exact same network call, instead of duplicating fetch logic.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 30_000;

export type CompletionErrorKind =
  | "missing_key"
  | "timeout"
  | "network_error"
  | "http_error"
  | "api_error";

export type CompletionResult =
  | { ok: true; rawText: string; model: string }
  | { ok: false; kind: CompletionErrorKind; message: string; detail?: string | null };

function sanitizeSecrets(text: string): string {
  const key = process.env.AI_API_KEY?.trim();
  if (!key) return text;
  return text.split(key).join("[REDACTED_API_KEY]");
}

export function resolveEffectiveModel(configModel: string | undefined): string {
  return configModel?.trim() || process.env.AI_API_MODEL?.trim() || process.env.AI_MODEL?.trim() || DEFAULT_MODEL;
}

export async function callAiChatCompletion(params: {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature: number;
  maxTokens: number;
}): Promise<CompletionResult> {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      kind: "missing_key",
      message: "کلید API برای هوش مصنوعی (AI_API_KEY) تنظیم نشده است.",
      detail: null,
    };
  }

  const baseUrl = (process.env.AI_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = resolveEffectiveModel(params.model);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: params.temperature,
        max_tokens: params.maxTokens,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    clearTimeout(timer);

    if (!response.ok) {
      const rawErr = await response.text().catch(() => "");
      return {
        ok: false,
        kind: "http_error",
        message: `سرویس هوش مصنوعی خطای HTTP ${response.status} بازگرداند.`,
        detail: sanitizeSecrets(rawErr),
      };
    }

    const payload = await response.json();
    const rawContent = payload?.choices?.[0]?.message?.content;

    if (typeof rawContent !== "string" || !rawContent.trim()) {
      return {
        ok: false,
        kind: "api_error",
        message: "پاسخ خالی از سرویس هوش مصنوعی دریافت شد.",
        detail: null,
      };
    }

    return { ok: true, rawText: rawContent, model };
  } catch (error) {
    clearTimeout(timer);
    const aborted = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
    return {
      ok: false,
      kind: aborted ? "timeout" : "network_error",
      message: aborted
        ? `زمان درخواست هوش مصنوعی به پایان رسید (${REQUEST_TIMEOUT_MS}ms).`
        : "خطای ارتباط با سرور هوش مصنوعی.",
      detail: error instanceof Error ? sanitizeSecrets(error.message) : null,
    };
  }
}
