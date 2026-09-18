/**
 * Bale Bot service — SERVER-SIDE ONLY.
 *
 * Never import this module from a client component. The bot token is read from
 * `process.env.BALE_BOT_TOKEN` inside the functions below (never at module scope),
 * so it can never be inlined into a client bundle, and it is redacted from every
 * error message that leaves this module.
 */

const BALE_API_BASE_URL = "https://tapi.bale.ai/bot";

/** Hard timeout so a stalled Bale request can never hang the Next.js server. */
const REQUEST_TIMEOUT_MS = 15_000;

export type BaleErrorKind =
  | "missing_token"
  | "missing_chat_id"
  | "empty_message"
  | "timeout"
  | "network_error"
  | "http_error"
  | "invalid_response"
  | "api_rejected"
  | "unknown_error";

export type BaleSendResult =
  | { ok: true; messageId: string | null }
  | { ok: false; kind: BaleErrorKind; message: string; detail?: string };

type BaleApiEnvelope = {
  ok?: unknown;
  description?: unknown;
  result?: { message_id?: unknown } | null;
};

function failure(kind: BaleErrorKind, message: string, detail?: string): BaleSendResult {
  return { ok: false, kind, message, detail };
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Removes the bot token from any text before it is returned, logged, or rendered.
 * Also redacts Telegram/Bale style tokens (`123456789:AA...`) found in upstream
 * error strings or URLs.
 */
function redactSecrets(value: string): string {
  const token = trimToUndefined(process.env.BALE_BOT_TOKEN);
  let output = value;

  if (token) {
    output = output.split(token).join("[REDACTED]");
  }

  return output.replace(/\b\d{6,}:[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]");
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.name === "TimeoutError";
}

/** True when both required environment variables are present and non-empty. */
export function isBaleConfigured(): boolean {
  return Boolean(trimToUndefined(process.env.BALE_BOT_TOKEN) && trimToUndefined(process.env.BALE_CHAT_ID));
}

/** Configuration diagnostics for the dashboard — never includes the token value. */
export function getBaleConfigStatus(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!trimToUndefined(process.env.BALE_BOT_TOKEN)) missing.push("BALE_BOT_TOKEN");
  if (!trimToUndefined(process.env.BALE_CHAT_ID)) missing.push("BALE_CHAT_ID");

  return { configured: missing.length === 0, missing };
}

/**
 * Sends a text message to the configured Bale chat.
 *
 * Flow: env credentials -> `https://tapi.bale.ai/bot<token>/sendMessage` -> parsed
 * Telegram-compatible envelope -> safe success/error result.
 */
export async function sendBaleMessage(text: string): Promise<BaleSendResult> {
  const message = text.trim();
  if (!message) {
    return failure("empty_message", "Message text is empty.");
  }

  const token = trimToUndefined(process.env.BALE_BOT_TOKEN);
  if (!token) {
    return failure("missing_token", "BALE_BOT_TOKEN is not configured.");
  }

  const chatId = trimToUndefined(process.env.BALE_CHAT_ID);
  if (!chatId) {
    return failure("missing_chat_id", "BALE_CHAT_ID is not configured.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BALE_API_BASE_URL}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (isAbortError(error)) {
      return failure("timeout", `Bale request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }
    return failure(
      "network_error",
      "Could not reach the Bale Bot API.",
      redactSecrets(error instanceof Error ? error.message : String(error)),
    );
  } finally {
    clearTimeout(timer);
  }

  let payload: BaleApiEnvelope;
  try {
    payload = (await response.json()) as BaleApiEnvelope;
  } catch {
    return failure(
      "invalid_response",
      "Bale returned a response that is not valid JSON.",
      `HTTP ${response.status}`,
    );
  }

  if (!response.ok) {
    return failure(
      "http_error",
      `Bale Bot API returned HTTP ${response.status}.`,
      typeof payload.description === "string" ? redactSecrets(payload.description) : undefined,
    );
  }

  if (payload.ok !== true) {
    return failure(
      "api_rejected",
      "Bale Bot API rejected the request.",
      typeof payload.description === "string" ? redactSecrets(payload.description) : undefined,
    );
  }

  const rawMessageId = payload.result?.message_id;
  const messageId = typeof rawMessageId === "number" || typeof rawMessageId === "string" ? String(rawMessageId) : null;

  return { ok: true, messageId };
}
