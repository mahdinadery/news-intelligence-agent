"use client";

import { useState } from "react";
import { StatusBadge } from "./status-badge";

type BaleTestStatus = "idle" | "sending" | "connected" | "dry" | "error";

type BaleTestResponse = {
  ok: boolean;
  dryRun?: boolean;
  mode?: string;
  messageId?: string | null;
  kind?: string;
  message?: string;
  detail?: string | null;
};

const statusLabel: Record<BaleTestStatus, string> = {
  idle: "بررسی نشده",
  sending: "در حال بررسی...",
  connected: "متصل",
  dry: "ثبت شد (آزمایشی)",
  error: "خطا در اتصال",
};

const statusTone = {
  idle: "muted",
  sending: "warning",
  connected: "success",
  dry: "warning",
  error: "danger",
} as const;

const buttonLabel: Record<BaleTestStatus, string> = {
  idle: "تست اتصال",
  sending: "در حال ارسال...",
  connected: "تست اتصال",
  dry: "تست اتصال",
  error: "تست مجدد",
};

const configHint: Record<string, string> = {
  missing_token: "متغیر محیطی BALE_BOT_TOKEN تنظیم نشده است.",
  missing_chat_id: "متغیر محیطی BALE_CHAT_ID تنظیم نشده است.",
  network_error: "سرور به tapi.bale.ai دسترسی ندارد. پیام در صندوق خروجی ثبت شد.",
  timeout: "پاسخ بله به‌موقع نرسید. پیام در صندوق خروجی ثبت شد.",
};

type BaleTestCardProps = {
  onTestComplete?: () => void;
};

export function BaleTestCard({ onTestComplete }: BaleTestCardProps) {
  const [status, setStatus] = useState<BaleTestStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  async function handleTest() {
    if (status === "sending") return;

    setStatus("sending");
    setMessage(null);
    setDetail(null);

    try {
      const response = await fetch("/api/bale/test", { method: "POST" });

      let data: BaleTestResponse | null = null;
      try {
        data = (await response.json()) as BaleTestResponse;
      } catch {
        data = null;
      }

      if (data?.ok && data.dryRun) {
        setStatus("dry");
        setMessage("پیام در صندوق خروجی آزمایشی ثبت شد (به بله ارسال نشد).");
        onTestComplete?.();
        return;
      }

      if (data?.ok) {
        setStatus("connected");
        setMessage("پیام با موفقیت به بله ارسال شد.");
        onTestComplete?.();
        return;
      }

      const kind = data?.kind ?? "unknown_error";
      setStatus("error");
      setMessage("ارسال پیام ناموفق بود.");
      setDetail(configHint[kind] ?? data?.message ?? `پاسخ نامعتبر از سرور (HTTP ${response.status}).`);
      onTestComplete?.();
    } catch {
      setStatus("error");
      setMessage("ارسال پیام ناموفق بود.");
      setDetail("ارتباط با سرور برقرار نشد.");
      onTestComplete?.();
    }
  }

  return (
    <section
      aria-labelledby="bale-heading"
      className="mt-6 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500">
            <svg
              aria-hidden="true"
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <path
                d="M5 4.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 4v-4H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M7 9h10M7 13h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h2 id="bale-heading" className="text-base font-bold text-slate-950">
              اتصال به بله
            </h2>
            <p className="mt-1 text-sm text-slate-500">ارسال یک پیام آزمایشی برای بررسی اتصال</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-500">وضعیت بله:</span>
          <StatusBadge tone={statusTone[status]}>{statusLabel[status]}</StatusBadge>
          <button
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
              status === "sending"
                ? "cursor-not-allowed bg-slate-100 text-slate-400"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
            disabled={status === "sending"}
            onClick={handleTest}
            type="button"
          >
            {buttonLabel[status]}
          </button>
        </div>
      </div>

      <div aria-live="polite" className="mt-5 border-t border-slate-100 pt-4">
        {message ? (
          <p
            className={`text-sm font-medium ${
              status === "connected"
                ? "text-emerald-700"
                : status === "error"
                  ? "text-rose-700"
                  : "text-amber-700"
            }`}
          >
            {message}
          </p>
        ) : (
          <p className="text-xs text-slate-400">
            با کلیک روی «تست اتصال»، یک پیام آزمایشی ثبت می‌شود و نتیجهٔ آن در صندوق خروجی نمایش داده
            می‌شود.
          </p>
        )}

        {detail ? (
          <p
            className="mt-2 break-words rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500"
            dir="ltr"
          >
            {detail}
          </p>
        ) : null}
      </div>
    </section>
  );
}
