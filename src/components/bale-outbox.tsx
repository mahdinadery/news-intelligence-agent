"use client";

import { useCallback, useEffect, useState } from "react";

type OutboxStatus = "sent" | "failed" | "dry-run";

type OutboxEntry = {
  id: string;
  text: string;
  status: OutboxStatus;
  channel: string;
  trigger?: "auto" | "manual" | "test";
  createdAt: string;
  messageId: string | null;
  error: string | null;
};

const statusMeta: Record<OutboxStatus, { label: string; className: string }> = {
  sent: { label: "ارسال شد ✓", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  failed: { label: "ارسال ناموفق", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  "dry-run": { label: "ثبت آزمایشی", className: "bg-amber-50 text-amber-700 ring-amber-200" },
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("fa-IR");
}

export function BaleOutbox({ refreshKey }: { refreshKey?: number }) {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/bale/outbox", { cache: "no-store" });
      const data = (await response.json()) as { entries?: OutboxEntry[] };
      setEntries(data.entries ?? []);
    } catch {
      // keep current entries on transient network blip
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // Auto-refresh every 5 seconds so messages sent automatically after AI analysis appear immediately
  useEffect(() => {
    const timer = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const autoCount = entries.filter((e) => e.trigger === "auto" && e.status === "sent").length;

  return (
    <section
      aria-labelledby="outbox-heading"
      className="mt-6 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 id="outbox-heading" className="text-lg font-bold text-slate-950">
              صندوق خروجی پیام‌ها (Local Outbox)
            </h2>
            {autoCount > 0 ? (
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-800">
                {autoCount} پیام خودکار 🤖
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-400">
            پیام‌های ارسال‌شده (هم به‌صورت خودکار توسط هوش مصنوعی و هم دستی) به‌طور دائمی در پایگاه داده ذخیره و در اینجا نمایش داده می‌شوند.
          </p>
        </div>
        <button
          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          onClick={() => void load()}
          type="button"
        >
          به‌روزرسانی فوری
        </button>
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-400">در حال بارگذاری صندوق خروجی...</p>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-5 py-10 text-center">
          <p className="text-sm font-medium text-slate-600">هنوز پیامی در صندوق خروجی ثبت نشده است.</p>
          <p className="mt-1 text-xs text-slate-400">
            با کلیک روی «تحلیل با AI» در صفحه اخبار یا «اجرای ارسال خودکار»، خبرهای واجد شرایط به اینجا ارسال می‌شوند.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => {
            const meta = statusMeta[entry.status] ?? statusMeta.sent;
            const isAuto = entry.trigger === "auto";

            return (
              <li
                className={`rounded-xl border p-4 transition-colors ${
                  isAuto
                    ? "border-violet-200/80 bg-violet-50/20"
                    : "border-slate-200/80 bg-slate-50/60"
                }`}
                key={entry.id}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${meta.className}`}
                  >
                    {meta.label}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${
                      isAuto
                        ? "bg-violet-100 text-violet-800 ring-violet-200"
                        : "bg-sky-50 text-sky-700 ring-sky-200"
                    }`}
                  >
                    {entry.channel}
                  </span>
                  <span className="ms-auto text-xs text-slate-400">{formatTime(entry.createdAt)}</span>
                </div>
                <div className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-800 font-sans">
                  {entry.text}
                </div>
                {entry.error ? (
                  <p
                    className="mt-2 break-words rounded-lg bg-white px-3 py-2 font-mono text-xs text-rose-600 ring-1 ring-rose-200"
                    dir="ltr"
                  >
                    {entry.error}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
