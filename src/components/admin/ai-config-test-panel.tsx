"use client";

import { useEffect, useState } from "react";
import type { AiConfigInput } from "@/lib/ai/config-types";

type ArticleOption = { id: string; title: string; source: string; analyzed: boolean };

type ValidationIssue = { field: string; message: string };

type TestResponse = {
  success: boolean;
  message?: string;
  detail?: string | null;
  model?: string;
  promptUsed?: { systemPrompt: string; userPrompt: string };
  rawResponse?: string;
  validation?: {
    valid: boolean;
    issues: ValidationIssue[];
    parsed: Record<string, unknown> | null;
  };
};

type Props = {
  draftConfig: AiConfigInput;
  adminKey: string;
};

function authHeaders(adminKey: string): HeadersInit {
  return adminKey ? { "x-admin-key": adminKey } : {};
}

export function AiConfigTestPanel({ draftConfig, adminKey }: Props) {
  const [articles, setArticles] = useState<ArticleOption[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<string>("");
  const [manualMode, setManualMode] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualSource, setManualSource] = useState("تست دستی");

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/ai-config/test", { headers: authHeaders(adminKey), cache: "no-store" })
      .then((res) => res.json())
      .then((data: { success: boolean; articles?: ArticleOption[] }) => {
        if (cancelled || !data.success) return;
        setArticles(data.articles ?? []);
        if (data.articles && data.articles.length > 0) {
          setSelectedArticleId(data.articles[0].id);
        }
      })
      .catch(() => {
        // Article list is a convenience only; manual mode still works.
      });

    return () => {
      cancelled = true;
    };
  }, [adminKey]);

  async function handleRunTest() {
    if (running) return;
    setRunning(true);
    setResult(null);

    const body: Record<string, unknown> = { draftConfig };

    if (manualMode) {
      body.manualArticle = {
        title: manualTitle,
        description: manualDescription || null,
        source: manualSource || "تست دستی",
        publishedAt: null,
      };
    } else {
      body.articleId = selectedArticleId;
    }

    try {
      const response = await fetch("/api/admin/ai-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(adminKey) },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as TestResponse;
      setResult(data);
    } catch {
      setResult({ success: false, message: "ارتباط با سرور برای اجرای آزمایش برقرار نشد." });
    } finally {
      setRunning(false);
    }
  }

  const canRun = manualMode ? manualTitle.trim().length > 0 : Boolean(selectedArticleId);

  return (
    <section className="rounded-2xl border border-violet-200/80 bg-white p-5 shadow-sm shadow-violet-100/40 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-600 text-white">
          <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
          </svg>
        </div>
        <div>
          <h2 className="text-base font-bold text-slate-950">آزمایش پیکربندی (Test Configuration)</h2>
          <p className="mt-1 text-sm text-slate-500">
            پیکربندی فعلی (شامل تغییرات ذخیره‌نشده) را روی یک خبر اجرا کنید — چیزی به بله یا Local ارسال نمی‌شود و
            خبری در پایگاه داده تغییر نمی‌کند.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <button
          className={`rounded-lg px-3 py-1.5 text-xs font-bold ${!manualMode ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600"}`}
          onClick={() => setManualMode(false)}
          type="button"
        >
          انتخاب از اخبار موجود
        </button>
        <button
          className={`rounded-lg px-3 py-1.5 text-xs font-bold ${manualMode ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-600"}`}
          onClick={() => setManualMode(true)}
          type="button"
        >
          وارد کردن خبر دستی
        </button>
      </div>

      {manualMode ? (
        <div className="mt-4 space-y-3">
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
            onChange={(event) => setManualTitle(event.target.value)}
            placeholder="عنوان خبر آزمایشی"
            value={manualTitle}
          />
          <textarea
            className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
            onChange={(event) => setManualDescription(event.target.value)}
            placeholder="متن/توضیحات خبر"
            rows={3}
            value={manualDescription}
          />
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
            onChange={(event) => setManualSource(event.target.value)}
            placeholder="منبع (اختیاری)"
            value={manualSource}
          />
        </div>
      ) : (
        <select
          className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
          onChange={(event) => setSelectedArticleId(event.target.value)}
          value={selectedArticleId}
        >
          {articles.length === 0 ? <option value="">هیچ خبری در پایگاه داده یافت نشد</option> : null}
          {articles.map((article) => (
            <option key={article.id} value={article.id}>
              {article.analyzed ? "✓ " : ""}
              {article.title} — {article.source}
            </option>
          ))}
        </select>
      )}

      <button
        className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300"
        disabled={running || !canRun}
        onClick={handleRunTest}
        type="button"
      >
        {running ? "در حال اجرای آزمایش..." : "اجرای آزمایش با AI"}
      </button>

      {result ? (
        <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
          {!result.success ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <p className="font-bold">{result.message}</p>
              {result.detail ? <p className="mt-1 font-mono text-xs opacity-80">{result.detail}</p> : null}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <span>مدل استفاده‌شده: {result.model}</span>
                <button
                  className="rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50"
                  onClick={() => setShowPrompt(!showPrompt)}
                  type="button"
                >
                  {showPrompt ? "پنهان کردن پرامپت ارسالی" : "نمایش پرامپت ارسالی"}
                </button>
              </div>

              {showPrompt && result.promptUsed ? (
                <div className="space-y-2">
                  <div>
                    <p className="text-xs font-bold text-slate-600">System Prompt:</p>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-[11px] leading-5 text-slate-100" dir="ltr">
                      {result.promptUsed.systemPrompt}
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-600">User Prompt:</p>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-[11px] leading-5 text-slate-100" dir="ltr">
                      {result.promptUsed.userPrompt}
                    </pre>
                  </div>
                </div>
              ) : null}

              <div>
                <p className="text-xs font-bold text-slate-600">پاسخ خام هوش مصنوعی (Raw Response):</p>
                <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-800 ring-1 ring-slate-100">
                  {result.rawResponse}
                </pre>
              </div>

              {result.validation?.valid ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-sm font-bold text-emerald-800">✓ خروجی با ساختار تعریف‌شده مطابقت دارد</p>
                  <dl className="mt-2 grid gap-1.5 text-xs text-emerald-900 sm:grid-cols-2">
                    {result.validation.parsed
                      ? Object.entries(result.validation.parsed).map(([key, value]) => (
                          <div className="flex justify-between gap-2 rounded-md bg-white/60 px-2 py-1" key={key}>
                            <dt className="font-mono">{key}</dt>
                            <dd className="truncate font-bold">{String(value)}</dd>
                          </div>
                        ))
                      : null}
                  </dl>
                </div>
              ) : (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-sm font-bold text-rose-800">خطاهای اعتبارسنجی ساختار خروجی:</p>
                  <ul className="mt-2 space-y-1 text-xs text-rose-700">
                    {result.validation?.issues.map((issue, index) => (
                      <li key={`${issue.field}-${index}`}>
                        <span className="font-mono font-bold">{issue.field}</span>: {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
