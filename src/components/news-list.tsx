"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NewsListItem } from "@/lib/news/ingest";

type AutoSendSummary = {
  attempted: boolean;
  enabled: boolean;
  matched: number;
  sent: number;
  skippedDuplicates: number;
  failed: number;
};

/** AI fields returned by the analyze endpoint. */
type AnalysisPatch = Pick<
  NewsListItem,
  | "summary"
  | "category"
  | "importanceScore"
  | "relevanceScore"
  | "noveltyScore"
  | "shouldSend"
  | "analysisReason"
  | "analyzedAt"
>;

const DESCRIPTION_LIMIT = 240;

export type NewsDeliveryState = {
  local: "sent" | "failed" | null;
  bale: "sent" | "failed" | null;
  lastSentAt: string | null;
};

export type NewsDeliveryStates = Record<string, NewsDeliveryState>;

type Destination = "local" | "bale" | "both";

type SendOutcome = {
  destination: "local" | "bale";
  status: "sent" | "failed" | "already_sent";
  ok: boolean;
  label?: string;
  errorMessage: string | null;
};

const DESTINATION_OPTIONS: Array<{ value: Destination; label: string }> = [
  { value: "local", label: "Local" },
  { value: "bale", label: "بله" },
  { value: "both", label: "هر دو" },
];

const DESTINATION_NAMES: Record<"local" | "bale", string> = {
  local: "Local",
  bale: "بله",
};

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trimEnd()}…`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "تاریخ نامشخص";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "تاریخ نامشخص";
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const barColor = score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-slate-400";
  const textColor = score >= 70 ? "text-emerald-700" : score >= 40 ? "text-amber-700" : "text-slate-600";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs font-semibold">
        <span className="text-slate-500">{label}</span>
        <span className={textColor}>{score}٪</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function StatusMark({ status }: { status: "sent" | "failed" | null }) {
  if (status === "sent") {
    return <span className="font-semibold text-emerald-700">✓ ارسال شده</span>;
  }
  if (status === "failed") {
    return <span className="font-semibold text-rose-700">! ناموفق</span>;
  }
  return <span className="text-slate-400">○ ارسال نشده</span>;
}

function ArticleCard({
  initialItem,
  initialDelivery,
}: {
  initialItem: NewsListItem;
  initialDelivery?: NewsDeliveryState;
}) {
  const [item, setItem] = useState<NewsListItem>(initialItem);
  const [delivery, setDelivery] = useState<NewsDeliveryState>(
    initialDelivery ?? { local: null, bale: null, lastSentAt: null },
  );
  const [destination, setDestination] = useState<Destination>("local");
  const [analyzing, setAnalyzing] = useState(false);
  const [sending, setSending] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const [sendResults, setSendResults] = useState<SendOutcome[] | null>(null);
  const router = useRouter();

  const hasAnalysis = Boolean(item.analyzedAt);

  async function handleAnalyze() {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);

    try {
      const res = await fetch(`/api/news/${item.id}/analyze`, { method: "POST" });
      const data = (await res.json()) as {
        success: boolean;
        message?: string;
        newsItem?: AnalysisPatch;
        autoSend?: AutoSendSummary;
      };
      setAutoNote(null);
      const patch = data.newsItem;

      if (data.success && patch) {
        setItem((prev) => ({
          ...prev,
          summary: patch.summary,
          category: patch.category,
          importanceScore: patch.importanceScore,
          relevanceScore: patch.relevanceScore,
          noveltyScore: patch.noveltyScore,
          shouldSend: patch.shouldSend,
          analysisReason: patch.analysisReason,
          analyzedAt: patch.analyzedAt,
        }));

        // The analysis endpoint also runs one auto-delivery pass for this article.
        const auto = data.autoSend;
        if (auto && auto.attempted && auto.enabled && auto.matched > 0) {
          setAutoNote(
            auto.sent > 0
              ? `ارسال خودکار: ${auto.sent} مقصد موفق بود.`
              : auto.failed > 0
                ? "ارسال خودکار تلاش شد اما ناموفق بود."
                : "این خبر قبلاً به مقصد انتخابی ارسال شده است.",
          );
          // Pull the persisted delivery marks from the server.
          router.refresh();
        } else if (auto && auto.attempted && auto.enabled) {
          setAutoNote("خبر تحلیل شد اما مشمول قوانین ارسال خودکار نیست.");
        } else if (auto && !auto.enabled) {
          setAutoNote("ارسال خودکار غیرفعال است.");
        }
      } else {
        setAnalyzeError(data.message || "تحلیل هوشمند با شکست مواجه شد.");
      }
    } catch {
      setAnalyzeError("خطا در ارتباط با سرور زمان اجرای تحلیل هوشمند.");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSend() {
    if (sending || !hasAnalysis) return;
    setSending(true);
    setSendResults(null);

    try {
      const res = await fetch(`/api/news/${item.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination }),
      });
      const data = (await res.json()) as {
        success: boolean;
        message?: string;
        results?: SendOutcome[];
        code?: string;
      };

      if (data.success && data.results) {
        setSendResults(data.results);
        setDelivery((prev) => {
          const next = { ...prev };
          for (const outcome of data.results ?? []) {
            if (outcome.status === "sent") next[outcome.destination] = "sent";
            else if (outcome.status === "failed") next[outcome.destination] = "failed";
          }
          return next;
        });
      } else {
        setSendResults([
          {
            destination: destination === "bale" ? "bale" : "local",
            status: "failed",
            ok: false,
            errorMessage: data.message ?? "ارسال ناموفق بود.",
          },
        ]);
      }
    } catch {
      setSendResults([
        {
          destination: destination === "bale" ? "bale" : "local",
          status: "failed",
          ok: false,
          errorMessage: "ارتباط با سرور برقرار نشد.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <li className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">{item.source}</span>
          <span className="text-slate-400">{formatDate(item.publishedAt)}</span>
        </div>

        {hasAnalysis ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            تحلیل شده
          </span>
        ) : null}
      </div>

      <h3 className="mt-3 text-base font-bold leading-7 text-slate-950 sm:text-lg">
        <a className="hover:underline" href={item.url} rel="noopener noreferrer nofollow" target="_blank">
          {item.title}
        </a>
      </h3>

      {item.description ? (
        <p className="mt-2 text-sm leading-7 text-slate-600">{truncate(item.description, DESCRIPTION_LIMIT)}</p>
      ) : null}

      {hasAnalysis ? (
        <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/20 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100/50 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-blue-900">دسته‌بندی:</span>
              <span className="rounded-lg bg-blue-100/60 px-2 py-1 text-xs font-bold text-blue-800">
                {item.category || "سایر"}
              </span>
            </div>

            {item.shouldSend ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                پیشنهاد ارسال به بله
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                عدم نیاز به ارسال
              </span>
            )}
          </div>

          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <ScoreBar label="اهمیت خبر" score={item.importanceScore ?? 0} />
            <ScoreBar label="میزان مرتبط بودن" score={item.relevanceScore ?? 0} />
            <ScoreBar label="تازگی خبر" score={item.noveltyScore ?? 0} />
          </div>

          <div className="mt-4 space-y-3 border-t border-blue-100/50 pt-3 text-sm">
            <div>
              <p className="font-bold text-blue-950">خلاصه تحلیل هوشمند:</p>
              <p className="mt-1 leading-7 text-slate-700">{item.summary}</p>
            </div>
            <div>
              <p className="font-bold text-blue-950">علت تصمیم‌گیری:</p>
              <p className="mt-1 leading-7 text-slate-700">{item.analysisReason}</p>
            </div>
          </div>
        </div>
      ) : null}

      {analyzeError ? (
        <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 p-3 text-xs text-rose-700">
          <p className="font-semibold">{analyzeError}</p>
          <p className="mt-1 text-slate-500">برای آزمایش مجدد روی دکمه تحلیل کلیک کنید.</p>
        </div>
      ) : null}

      {autoNote && !analyzeError ? (
        <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-2 text-xs font-medium text-violet-800">
          {autoNote}
        </div>
      ) : null}

      {/* Delivery block — only for analyzed articles */}
      {hasAnalysis ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="grid gap-3 text-xs sm:grid-cols-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">ارسال Local:</span>
              <StatusMark status={delivery.local} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-500">ارسال بله:</span>
              <StatusMark status={delivery.bale} />
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <fieldset className="flex flex-wrap items-center gap-3">
              <legend className="sr-only">مقصد ارسال</legend>
              <span className="text-xs font-semibold text-slate-600">مقصد ارسال:</span>
              {DESTINATION_OPTIONS.map((option) => (
                <label
                  className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600"
                  key={option.value}
                >
                  <input
                    checked={destination === option.value}
                    className="h-3.5 w-3.5 accent-blue-600"
                    disabled={sending}
                    name={`destination-${item.id}`}
                    onChange={() => setDestination(option.value)}
                    type="radio"
                    value={option.value}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            <button
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
                sending
                  ? "cursor-not-allowed bg-slate-200 text-slate-500"
                  : delivery.local === "sent" && delivery.bale === "sent"
                    ? "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200"
                    : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
              disabled={sending}
              onClick={handleSend}
              type="button"
            >
              {sending ? "در حال ارسال..." : delivery.local === "sent" && delivery.bale === "sent" ? "ارسال شد" : "ارسال خبر"}
            </button>
          </div>

          {sendResults ? (
            <ul className="mt-4 space-y-2 border-t border-slate-200 pt-3">
              {sendResults.map((outcome) => {
                const name = DESTINATION_NAMES[outcome.destination];
                if (outcome.status === "already_sent") {
                  return (
                    <li className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800" key={outcome.destination}>
                      ارسال به {name}: {outcome.errorMessage ?? "این خبر قبلاً به این مقصد ارسال شده است."}
                    </li>
                  );
                }
                return (
                  <li
                    className={`rounded-lg px-3 py-2 text-xs font-medium ${
                      outcome.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
                    }`}
                    key={outcome.destination}
                  >
                    <span>
                      ارسال به {name}: {outcome.ok ? "موفق" : "ناموفق"}
                    </span>
                    {outcome.errorMessage ? (
                      <span className="mt-1 block break-words font-mono text-[11px] opacity-80" dir="ltr">
                        {outcome.errorMessage}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
        <a
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:underline"
          href={item.url}
          rel="noopener noreferrer nofollow"
          target="_blank"
        >
          مشاهده خبر اصلی
          <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M14 4h6v6M20 4 10 14M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"
            />
          </svg>
        </a>

        <button
          className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
            analyzing
              ? "cursor-not-allowed bg-slate-100 text-slate-400"
              : hasAnalysis
                ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                : "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
          }`}
          disabled={analyzing}
          onClick={handleAnalyze}
          type="button"
        >
          {analyzing ? "در حال تحلیل..." : hasAnalysis ? "تحلیل مجدد هوشمند" : "تحلیل با AI"}
        </button>
      </div>
    </li>
  );
}

export function NewsList({ items, deliveryStates }: { items: NewsListItem[]; deliveryStates?: NewsDeliveryStates }) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-16 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
          <svg aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13Z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 8h8M8 12h8M8 16h5" />
          </svg>
        </div>
        <p className="mt-5 text-sm font-semibold text-slate-700">هنوز خبری ذخیره نشده است.</p>
        <p className="mt-1 max-w-md text-xs leading-5 text-slate-400">
          به داشبورد بروید و با دکمه «دریافت اخبار» اولین همگام‌سازی را انجام دهید.
        </p>
        <a
          className="mt-5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          href="/dashboard"
        >
          رفتن به داشبورد
        </a>
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <ArticleCard initialDelivery={deliveryStates?.[item.id]} initialItem={item} key={item.id} />
      ))}
    </ul>
  );
}
