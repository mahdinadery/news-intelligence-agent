"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildIntervalTimes, detectInterval, intervalLabel } from "@/lib/agent/interval-times";
import { describeRejectionReasons } from "@/lib/agent/rejection-reasons";
import { diagnoseRunSummary } from "@/lib/agent/run-diagnosis";
import { StatusBadge } from "./status-badge";

type Destination = "local" | "bale" | "both";

type ScheduleConfig = {
  enabled: boolean;
  timezone: string;
  times: string[];
  destination: Destination;
  minImportance: number;
  minRelevance: number;
  minNovelty: number;
  requireAiRecommendation: boolean;
  maxAnalyze: number;
  maxSend: number;
};

type RunSummary = {
  ok: boolean;
  trigger: "schedule" | "manual";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  slotKey: string | null;
  ingest: { attempted: boolean; sources: number; created: number; duplicates: number; failed: number; detail?: string } | null;
  analysis: { selected: number; analyzed: number; failed: number; skippedOfftopic: number } | null;
  send: {
    enabled: boolean;
    destination: string;
    considered: number;
    matched: number;
    sent: number;
    skippedDuplicates: number;
    skippedReview: number;
    failed: number;
    rejected?: Array<{ title: string; reasons: string[] }>;
  } | null;
  errors: string[];
};

type ApiResponse = {
  success: boolean;
  config?: ScheduleConfig;
  status?: {
    persisted: boolean;
    enabled: boolean;
    nextRunAt: string | null;
    nextRunSlot: string | null;
    lastRunAt: string | null;
    lastRunSlot: string | null;
    lastResult: RunSummary | null;
    dueReason?: string;
    running?: boolean;
  };
  destinationsReady?: { local: boolean; bale: boolean };
  baleMissing?: string[];
  description?: string[];
  message?: string;
  errors?: string[];
  summary?: RunSummary;
};

const TIMEZONES = [
  "Asia/Tehran",
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "Asia/Dubai",
  "Asia/Istanbul",
  "America/New_York",
];

const DESTINATION_LABELS: Record<Destination, string> = {
  bale: "بله (کانال/چت)",
  local: "صندوق محلی (بدون ارسال واقعی)",
  both: "بله + صندوق محلی",
};

const DIAGNOSIS_TONES = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-rose-200 bg-rose-50 text-rose-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
} as const;

function authHeaders(adminKey: string): Record<string, string> {
  return adminKey ? { "x-admin-key": adminKey } : {};
}

function formatInZone(iso: string | null, timeZone: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return date.toLocaleString("fa-IR", { timeZone, dateStyle: "medium", timeStyle: "short" });
  } catch {
    return date.toLocaleString("fa-IR");
  }
}

const INTERVAL_PRESETS = [15, 30, 60, 120];

function defaultConfig(): ScheduleConfig {
  return {
    enabled: false,
    timezone: "Asia/Tehran",
    times: ["08:00"],
    destination: "bale",
    minImportance: 50,
    minRelevance: 50,
    minNovelty: 0,
    requireAiRecommendation: false,
    maxAnalyze: 8,
    maxSend: 10,
  };
}

export function ScheduleCard({
  adminKey = "",
  onRunComplete,
}: {
  adminKey?: string;
  onRunComplete?: () => void;
}) {
  const [config, setConfig] = useState<ScheduleConfig>(defaultConfig);
  const [status, setStatus] = useState<ApiResponse["status"] | null>(null);
  const [baleReady, setBaleReady] = useState<boolean | null>(null);
  const [baleMissing, setBaleMissing] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [timesEditing, setTimesEditing] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/agent/scheduler", { cache: "no-store" })
      .then((response) => response.json() as Promise<ApiResponse>)
      .then((data) => {
        if (data.success && data.config) {
          setConfig(data.config);
          setStatus(data.status ?? null);
          setBaleReady(Boolean(data.destinationsReady?.bale));
          setBaleMissing(data.baleMissing ?? []);
          setLastRun(data.status?.lastResult ?? null);
        }
      })
      .catch(() => {
        setMessage({ kind: "err", text: "بارگذاری وضعیت زمان‌بندی ناموفق بود." });
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const nextRunLabel = useMemo(
    () => formatInZone(status?.nextRunAt ?? null, config.timezone),
    [status?.nextRunAt, config.timezone],
  );

  const interval = useMemo(() => detectInterval(config.times), [config.times]);
  const diagnosis = useMemo(() => diagnoseRunSummary(lastRun), [lastRun]);

  function updateTime(index: number, value: string) {
    setConfig((prev) => {
      const times = [...prev.times];
      times[index] = value;
      return { ...prev, times };
    });
  }

  function addTime() {
    setConfig((prev) => ({ ...prev, times: [...prev.times, "18:00"] }));
  }

  function removeTime(index: number) {
    setConfig((prev) => ({ ...prev, times: prev.times.filter((_, i) => i !== index) }));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/agent/scheduler", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders(adminKey) },
        body: JSON.stringify(config),
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok || !data.success) {
        const details = data.errors?.length ? ` — ${data.errors.join(" · ")}` : "";
        setMessage({
          kind: "err",
          text:
            response.status === 401
              ? "برای تغییر زمان‌بندی باید کلید مدیریتی را وارد کرده باشید. یک‌بار با ?key=... وارد داشبورد شوید یا از صفحه «پیکربندی AI» کلید را وارد کنید."
              : `${data.message ?? "ذخیره زمان‌بندی ناموفق بود."}${details}`,
        });
        return;
      }

      if (data.config) setConfig(data.config);
      setStatus(data.status ?? null);
      setMessage({ kind: "ok", text: "زمان‌بندی ذخیره شد. اجرای خودکار از نوبت بعدی فعال است." });
    } catch {
      setMessage({ kind: "err", text: "ارتباط با سرور برقرار نشد." });
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    if (running) return;
    setRunning(true);
    setMessage(null);

    try {
      const response = await fetch("/api/agent/scheduler", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(adminKey) },
        body: "{}",
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok || !data.success || !data.summary) {
        setMessage({
          kind: "err",
          text:
            response.status === 401
              ? "اجرای فوری به کلید مدیریتی نیاز دارد (یک‌بار با ?key=... وارد شوید)."
              : data.message ?? "اجرای فوری ناموفق بود.",
        });
        return;
      }

      setLastRun(data.summary);
      setMessage({
        kind: data.summary.ok ? "ok" : "err",
        text: `اجرای فوری تمام شد: ${data.summary.analysis?.analyzed ?? 0} تحلیل، ${data.summary.send?.sent ?? 0} ارسال${
          data.summary.errors.length > 0 ? ` — ${data.summary.errors.length} خطا` : ""
        }.`,
      });
      onRunComplete?.();
      void load();
    } catch {
      setMessage({ kind: "err", text: "ارتباط با سرور برقرار نشد." });
    } finally {
      setRunning(false);
    }
  }

  const enabledCount = config.times.filter(Boolean).length;

  return (
    <section
      aria-labelledby="schedule-heading"
      className="mt-6 rounded-2xl border border-sky-200/80 bg-white p-5 shadow-sm shadow-sky-100/50 sm:p-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-sky-600 text-white shadow-md shadow-sky-600/20">
            <svg aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7v5l3.2 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-slate-950" id="schedule-heading">
                ارسال خودکار زمان‌بندی‌شده (تحلیل + بله)
              </h2>
              <StatusBadge tone={config.enabled ? "success" : "muted"}>
                {config.enabled ? "زمان‌بندی فعال" : "خاموش"}
              </StatusBadge>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              در هر زمان مشخص، خبرهای تازه دریافت، تحلیل و در صورت عبور از حد نصاب‌ها بدون تأیید دستی به بله ارسال
              می‌شوند. نوبت‌ها به وقت <b className="text-slate-700">{config.timezone}</b> اجرا می‌شوند و اجرای تکراری
              همان نوبت ممکن نیست.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`rounded-xl px-4 py-2.5 text-sm font-bold shadow-sm transition-all ${
              running ? "cursor-not-allowed bg-slate-100 text-slate-400" : "bg-sky-600 text-white hover:bg-sky-700"
            }`}
            disabled={running}
            onClick={handleRunNow}
            type="button"
          >
            {running ? "در حال اجرا…" : "اجرای فوری چرخه کامل"}
          </button>
          <button
            className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-bold text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving}
            onClick={handleSave}
            type="button"
          >
            {saving ? "در حال ذخیره…" : "ذخیره زمان‌بندی"}
          </button>
        </div>
      </div>

      {message ? (
        <p
          className={`mt-4 rounded-xl border px-4 py-3 text-sm leading-6 ${
            message.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3.5">
          <p className="text-xs font-semibold text-slate-500">وضعیت</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-800">
              <input
                checked={config.enabled}
                className="h-4 w-4 accent-sky-600"
                onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
                type="checkbox"
              />
              فعال باشد
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            نوبت بعدی: <b className="text-slate-800">{config.enabled ? nextRunLabel : "—"}</b>
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 p-3.5">
          <p className="text-xs font-semibold text-slate-500">مقصد ارسال خودکار</p>
          <select
            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
            onChange={(event) => setConfig({ ...config, destination: event.target.value as Destination })}
            value={config.destination}
          >
            {(Object.keys(DESTINATION_LABELS) as Destination[]).map((value) => (
              <option key={value} value={value}>
                {DESTINATION_LABELS[value]}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-500">
            بله:{" "}
            {baleReady ? (
              <b className="text-emerald-700">آماده ✓</b>
            ) : (
              <b className="text-rose-700">
                تنظیم نشده{baleMissing.length > 0 ? ` (${baleMissing.join(", ")})` : ""}
              </b>
            )}
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 p-3.5">
          <p className="text-xs font-semibold text-slate-500">آخرین اجرا</p>
          <p className="mt-2 text-xs text-slate-600">
            {lastRun ? (
              <>
                {formatInZone(lastRun.startedAt, config.timezone)}
                <span className="mx-1 text-slate-300">·</span>
                <span className={lastRun.ok ? "text-emerald-700" : "text-amber-700"}>
                  {lastRun.send?.sent ?? 0} ارسال / {lastRun.analysis?.analyzed ?? 0} تحلیل
                </span>
              </>
            ) : (
              "هنوز اجرا نشده است"
            )}
          </p>
          <p className="mt-2 text-[11px] leading-5 text-slate-400">
            اجرای خودکار فقط وقتی رخ می‌دهد که این کارت ذخیره و فعال شده باشد و کرون بیرونی هر چند دقیقه یک‌بار تیک
            بزند.
          </p>
        </div>
      </div>

      {diagnosis ? (
        <div className={`mt-4 rounded-xl border px-4 py-3 text-xs leading-6 ${DIAGNOSIS_TONES[diagnosis.level]}`}>
          <p className="font-bold">{diagnosis.title}</p>
          {diagnosis.hints.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pr-4">
              {diagnosis.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {lastRun?.send?.rejected && lastRun.send.rejected.length > 0 ? (
        <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-700">
          <summary className="cursor-pointer font-bold">
            چرا خبری ارسال نشد؟ ({lastRun.send.rejected.length} نمونه از خبرهای ردشده)
          </summary>
          <ul className="mt-2 space-y-1">
            {lastRun.send.rejected.map((item, index) => (
              <li className="break-words" key={`${item.title}-${index}`}>
                • <b>{item.title}</b> — {describeRejectionReasons(item.reasons)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-5 text-slate-400">
            برای ارسال، همهٔ حد نصاب‌ها (اهمیت، مرتبط بودن و در صورت تنظیم تازگی) باید هم‌زمان برقرار باشند. حد
            نصاب‌ها را در «تنظیمات پیشرفته» و کلیدواژه‌های ممنوع را در «پیکربندی AI» تنظیم کنید.
          </p>
        </details>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-slate-800">زمان‌های اجرا (به وقت {config.timezone})</p>
            <button
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50"
              onClick={() => {
                addTime();
                setTimesEditing(true);
              }}
              type="button"
            >
              + افزودن زمان
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-500">تکرار سریع:</span>
            {INTERVAL_PRESETS.map((minutes) => (
              <button
                className={`rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                  interval === minutes
                    ? "border-sky-300 bg-sky-50 text-sky-700"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700"
                }`}
                key={minutes}
                onClick={() => {
                  setConfig({ ...config, times: buildIntervalTimes(minutes) });
                  setTimesEditing(false);
                }}
                type="button"
              >
                {intervalLabel(minutes)}
              </button>
            ))}
          </div>

          {interval && !timesEditing ? (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-6 text-emerald-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  زمان‌بندی فعلی: <b>{intervalLabel(interval)}</b> ({config.times.length} نوبت در روز)
                </span>
                <button
                  className="rounded-md border border-emerald-200 bg-white px-2 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                  onClick={() => setTimesEditing(true)}
                  type="button"
                >
                  ویرایش دستی زمان‌ها
                </button>
              </div>
              <p className="mt-1 text-[11px] text-emerald-800/80">
                در هر نوبت، خبرهای تازه تحلیل می‌شوند و فقط در صورت وجود خبر واجد شرایط ارسالی انجام می‌شود.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-2 space-y-2">
                {config.times.length === 0 ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    حداقل یک زمان اضافه کنید تا زمان‌بندی بتواند اجرا شود.
                  </p>
                ) : null}
                {config.times.map((time, index) => (
                  <div className="flex items-center gap-2" key={`${index}-${time}`}>
                    <input
                      className="w-36 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
                      onChange={(event) => updateTime(index, event.target.value)}
                      step={300}
                      type="time"
                      value={time}
                    />
                    <button
                      aria-label="حذف زمان"
                      className="rounded-lg px-2 py-1.5 text-xs font-bold text-rose-500 hover:bg-rose-50 disabled:opacity-40"
                      disabled={config.times.length <= 1}
                      onClick={() => removeTime(index)}
                      type="button"
                    >
                      حذف
                    </button>
                  </div>
                ))}
              </div>

              {interval ? (
                <button
                  className="mt-2 text-[11px] font-bold text-emerald-700 underline-offset-2 hover:underline"
                  onClick={() => setTimesEditing(false)}
                  type="button"
                >
                  نمایش خلاصه بازه
                </button>
              ) : null}
            </>
          )}

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-500">منطقه زمانی</span>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
              onChange={(event) => setConfig({ ...config, timezone: event.target.value })}
              value={config.timezone}
            >
              {(TIMEZONES.includes(config.timezone) ? TIMEZONES : [config.timezone, ...TIMEZONES]).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <button
            className="flex w-full items-center justify-between text-sm font-bold text-slate-800"
            onClick={() => setAdvancedOpen((value) => !value)}
            type="button"
          >
            <span>تنظیمات پیشرفته (حد نصاب‌ها و حجم هر اجرا)</span>
            <span className="text-slate-400">{advancedOpen ? "−" : "+"}</span>
          </button>

          {advancedOpen ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <NumberField
                label="حداقل اهمیت"
                max={100}
                min={0}
                onChange={(value) => setConfig({ ...config, minImportance: value })}
                value={config.minImportance}
              />
              <NumberField
                label="حداقل مرتبط بودن"
                max={100}
                min={0}
                onChange={(value) => setConfig({ ...config, minRelevance: value })}
                value={config.minRelevance}
              />
              <NumberField
                label="حداقل تازگی"
                max={100}
                min={0}
                onChange={(value) => setConfig({ ...config, minNovelty: value })}
                value={config.minNovelty}
              />
              <NumberField
                label="حداکثر تحلیل در هر اجرا"
                max={30}
                min={1}
                onChange={(value) => setConfig({ ...config, maxAnalyze: value })}
                value={config.maxAnalyze}
              />
              <NumberField
                label="حداکثر ارسال در هر اجرا"
                max={50}
                min={1}
                onChange={(value) => setConfig({ ...config, maxSend: value })}
                value={config.maxSend}
              />
              <label className="flex items-start gap-2 text-xs leading-5 text-slate-600 sm:col-span-2">
                <input
                  checked={config.requireAiRecommendation}
                  className="mt-0.5 h-4 w-4 accent-sky-600"
                  onChange={(event) => setConfig({ ...config, requireAiRecommendation: event.target.checked })}
                  type="checkbox"
                />
                <span>
                  فقط خبرهایی ارسال شوند که هوش مصنوعی هم صریحاً ارسال را توصیه کرده است (
                  <code className="rounded bg-slate-100 px-1 font-mono text-[10px]" dir="ltr">
                    shouldSend = true
                  </code>
                  ).
                </span>
              </label>
            </div>
          ) : (
            <p className="mt-2 text-xs leading-6 text-slate-500">
              پیش‌فرض: اهمیت ≥ {config.minImportance}٪، مرتبط بودن ≥ {config.minRelevance}٪، حداکثر{" "}
              {config.maxAnalyze} تحلیل و {config.maxSend} ارسال در هر نوبت.
            </p>
          )}
        </div>
      </div>

      {lastRun && lastRun.errors.length > 0 ? (
        <details className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
          <summary className="cursor-pointer font-bold">خطاهای آخرین اجرا ({lastRun.errors.length})</summary>
          <ul className="mt-2 space-y-1">
            {lastRun.errors.map((error, index) => (
              <li key={index} className="break-words">
                • {error}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="mt-4 text-[11px] leading-5 text-slate-400">
        برای ارسال واقعی به بله، متغیرهای <code className="font-mono" dir="ltr">BALE_BOT_TOKEN</code> و{" "}
        <code className="font-mono" dir="ltr">BALE_CHAT_ID</code> باید روی سرور تنظیم شده باشند. اجرای زمان‌بندی‌شده
        توسط کرون بیرونی (GitHub Actions) فعال می‌شود و به باز بودن دائمی سرور نیاز ندارد.
        {loading ? " — در حال بارگذاری وضعیت…" : ""}
      </p>
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      <input
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-400 focus:outline-none"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        value={value}
      />
    </label>
  );
}
