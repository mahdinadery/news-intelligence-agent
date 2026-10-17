"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AI_FEATURE_ORDER,
  DEFAULT_AUTO_SEND_POLICY,
  DEFAULT_CONFIG_NAME,
  DEFAULT_DECISION_RULES,
  DEFAULT_FEATURES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL_PLACEHOLDER,
  DEFAULT_OUTPUT_SCHEMA,
  DEFAULT_PUBLISHING_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE,
  DEFAULT_TOPIC_FILTER,
  type AiAutoSendPolicy,
  type AiConfigInput,
  type AiFeatureKey,
  type AiTopicFilterConfig,
  type ActiveAiConfig,
} from "@/lib/ai/config-types";
import { PUBLISHING_TEMPLATE_VARS, findUnknownTemplateVars } from "@/lib/delivery/template";
import { TOPIC_PRESETS } from "@/lib/news/topic-filter";
import { AiConfigFeatureRow } from "./ai-config-feature-row";
import { AiConfigOutputFieldRow } from "./ai-config-output-field-row";
import { SchemaRepairCard } from "./schema-repair-card";
import { AiConfigTestPanel } from "./ai-config-test-panel";
import { AiConfigTopicRow } from "./ai-config-topic-row";
import { AiConfigVersionHistory } from "./ai-config-version-history";

type Props = { adminKey: string };

// These two fields are read directly by the existing analysis pipeline
// (src/lib/news/analyze.ts / src/lib/delivery) — disabling them would silently
// break already-working functionality, so their toggle stays locked in the UI.
const LOCKED_FEATURES: AiFeatureKey[] = ["summary", "shouldSend"];

function buildDraft(
  config: Pick<
    ActiveAiConfig,
    | "name"
    | "provider"
    | "model"
    | "systemPrompt"
    | "temperature"
    | "maxTokens"
    | "features"
    | "decisionRules"
    | "outputSchema"
    | "publishingTemplate"
    | "topicFilter"
    | "autoSendPolicy"
  >,
): AiConfigInput {
  return {
    name: config.name,
    provider: config.provider,
    model: config.model,
    systemPrompt: config.systemPrompt,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    features: config.features,
    decisionRules: config.decisionRules,
    outputSchema: config.outputSchema,
    publishingTemplate: config.publishingTemplate ?? "",
    topicFilter: config.topicFilter ?? DEFAULT_TOPIC_FILTER,
    autoSendPolicy: config.autoSendPolicy ?? DEFAULT_AUTO_SEND_POLICY,
  };
}

function defaultDraft(): AiConfigInput {
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
    topicFilter: DEFAULT_TOPIC_FILTER,
    autoSendPolicy: DEFAULT_AUTO_SEND_POLICY,
  };
}

function authHeaders(adminKey: string): HeadersInit {
  return adminKey ? { "x-admin-key": adminKey } : {};
}

export function AiConfigConsole({ adminKey }: Props) {
  const [draft, setDraft] = useState<AiConfigInput>(defaultDraft());
  const [meta, setMeta] = useState<{ version: number; isActive: boolean; updatedAt: string } | null>(null);
  const [aiKeyConfigured, setAiKeyConfigured] = useState(false);
  const [effectiveModel, setEffectiveModel] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"draft" | "activate" | null>(null);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [loadFailure, setLoadFailure] = useState<{
    message: string;
    hint?: string;
    detail?: string;
    code?: string | null;
    schemaMismatch?: boolean;
  } | null>(null);
  const [schemaSynced, setSchemaSynced] = useState(false);

  const [versions, setVersions] = useState<ActiveAiConfig[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [activatingId, setActivatingId] = useState<string | null>(null);

  const loadActive = useCallback(() => {
    return fetch("/api/admin/ai-config", { headers: authHeaders(adminKey), cache: "no-store" })
      .then((response) => response.json() as Promise<{
        success: boolean;
        config?: ActiveAiConfig;
        aiKeyConfigured?: boolean;
        effectiveModel?: string;
        message?: string;
        detail?: string;
        hint?: string;
        code?: string | null;
        schemaMismatch?: boolean;
        schemaSynced?: boolean;
      }>)
      .then((data) => {
        if (data.success && data.config) {
          setDraft(buildDraft(data.config));
          setMeta({ version: data.config.version, isActive: data.config.isActive, updatedAt: data.config.updatedAt });
          setAiKeyConfigured(Boolean(data.aiKeyConfigured));
          setEffectiveModel(data.effectiveModel ?? "");
          setLoadFailure(null);
          setSchemaSynced(Boolean(data.schemaSynced));
        } else if (!data.success) {
          setLoadFailure({
            message: data.message ?? "بارگذاری پیکربندی ناموفق بود.",
            hint: data.hint,
            detail: data.detail,
            code: data.code,
            schemaMismatch: data.schemaMismatch,
          });
        }
      })
      .catch(() => {
        setLoadFailure({ message: "ارتباط با سرور برای بارگذاری پیکربندی برقرار نشد." });
      })
      .finally(() => {
        setLoading(false);
      });
  }, [adminKey]);

  const loadVersions = useCallback(() => {
    return fetch("/api/admin/ai-config/history", { headers: authHeaders(adminKey), cache: "no-store" })
      .then((response) => response.json() as Promise<{ success: boolean; versions?: ActiveAiConfig[] }>)
      .then((data) => {
        if (data.success) setVersions(data.versions ?? []);
        else setVersions([]);
      })
      .catch(() => {
        setVersions([]);
      })
      .finally(() => {
        setVersionsLoading(false);
      });
  }, [adminKey]);

  useEffect(() => {
    void loadActive();
    void loadVersions();
  }, [loadActive, loadVersions]);

  async function handleSave(activate: boolean) {
    setSaving(activate ? "activate" : "draft");
    setSaveErrors([]);
    setSaveSuccess(null);

    try {
      const response = await fetch("/api/admin/ai-config", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(adminKey) },
        body: JSON.stringify({ ...draft, activate }),
      });
      const data = (await response.json()) as {
        success: boolean;
        config?: ActiveAiConfig;
        message?: string;
        errors?: string[];
      };

      if (data.success && data.config) {
        setDraft(buildDraft(data.config));
        setMeta({ version: data.config.version, isActive: data.config.isActive, updatedAt: data.config.updatedAt });
        setLoadFailure(null);
        setSaveSuccess(
          activate
            ? `نسخه ${data.config.version} ذخیره و فعال شد.`
            : `نسخه ${data.config.version} به‌عنوان پیش‌نویس ذخیره شد (غیرفعال).`,
        );
        await loadVersions();
      } else {
        setSaveErrors(data.errors && data.errors.length > 0 ? data.errors : [data.message ?? "ذخیره پیکربندی ناموفق بود."]);
      }
    } catch {
      setSaveErrors(["ارتباط با سرور برای ذخیره پیکربندی برقرار نشد."]);
    } finally {
      setSaving(null);
    }
  }

  async function handleActivateVersion(id: string) {
    setActivatingId(id);
    try {
      const response = await fetch("/api/admin/ai-config/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(adminKey) },
        body: JSON.stringify({ id }),
      });
      const data = (await response.json()) as { success: boolean; config?: ActiveAiConfig; message?: string };
      if (data.success && data.config) {
        setDraft(buildDraft(data.config));
        setMeta({ version: data.config.version, isActive: data.config.isActive, updatedAt: data.config.updatedAt });
        setSaveSuccess(`نسخه ${data.config.version} فعال شد.`);
        await loadVersions();
      }
    } finally {
      setActivatingId(null);
    }
  }

  function handleResetToDefault() {
    setDraft(defaultDraft());
    setSaveErrors([]);
    setSaveSuccess("مقادیر پیش‌فرض بارگذاری شد — برای اعمال دائمی، «ذخیره و فعال‌سازی» را بزنید.");
  }

  const promptChars = draft.systemPrompt.length;
  const promptTokensEstimate = Math.ceil(promptChars / 4);
  const unknownTemplateVars = findUnknownTemplateVars(draft.publishingTemplate ?? "");

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-200/80 pb-6">
        <p className="mb-2 text-sm font-medium text-blue-600">مرکز پیکربندی هوش مصنوعی</p>
        <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">پیکربندی تحلیل هوش مصنوعی</h1>
        <p className="mt-2 text-sm text-slate-500">
          رفتار تحلیل هوش مصنوعی (پرامپت، ویژگی‌ها، آستانه‌ها و ساختار خروجی) را بدون نیاز به تغییر کد مدیریت کنید.
        </p>
        {meta ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-bold text-slate-700">نسخه فعال: {meta.version}</span>
            <span>آخرین به‌روزرسانی: {new Date(meta.updatedAt).toLocaleString("fa-IR")}</span>
          </div>
        ) : null}
      </header>

      {loading ? <p className="text-sm text-slate-400">در حال بارگذاری پیکربندی...</p> : null}

      {schemaSynced && !loadFailure ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
          ساختار پایگاه داده با کد همگام نبود؛ به‌صورت خودکار (بدون حذف داده) همگام‌سازی شد و پیکربندی از مقادیر پیش‌فرض
          ساخته شد. اکنون می‌توانید مقادیر را ذخیره و فعال کنید.
        </p>
      ) : null}

      {loadFailure ? (
        <SchemaRepairCard
          adminKey={adminKey}
          code={loadFailure.code}
          detail={loadFailure.detail}
          hint={loadFailure.hint}
          message={loadFailure.message}
          onRepaired={() => {
            setLoading(true);
            void loadActive();
            void loadVersions();
          }}
          schemaMismatch={Boolean(loadFailure.schemaMismatch)}
        />
      ) : null}

      {/* A. Provider & Model */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6">
        <h2 className="text-base font-bold text-slate-950">ارائه‌دهنده و مدل هوش مصنوعی</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="ارائه‌دهنده">
            <input
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
              disabled
              value="OpenAI-compatible"
            />
          </Field>
          <Field label="مدل (خالی = استفاده از env)">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              onChange={(event) => setDraft({ ...draft, model: event.target.value })}
              placeholder={effectiveModel || "gpt-4o-mini"}
              value={draft.model}
            />
          </Field>
          <Field label="Temperature (۰ تا ۲)">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              max={2}
              min={0}
              onChange={(event) => setDraft({ ...draft, temperature: Number(event.target.value) })}
              step={0.1}
              type="number"
              value={draft.temperature}
            />
          </Field>
          <Field label="حداکثر توکن خروجی">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              max={8000}
              min={50}
              onChange={(event) => setDraft({ ...draft, maxTokens: Number(event.target.value) })}
              type="number"
              value={draft.maxTokens}
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-xs">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-bold ring-1 ring-inset ${aiKeyConfigured ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${aiKeyConfigured ? "bg-emerald-500" : "bg-rose-500"}`} />
            {aiKeyConfigured ? "کلید API تنظیم شده" : "کلید API تنظیم نشده (AI_API_KEY)"}
          </span>
          <span className="text-slate-500">مدل مؤثر فعلی: <b className="text-slate-800">{effectiveModel || "—"}</b></span>
        </div>

        {!loading && !aiKeyConfigured ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-6 text-amber-800">
            <b>تحلیل هوش مصنوعی غیرفعال است:</b> متغیر{" "}
            <code className="rounded bg-white px-1 font-mono text-[11px]" dir="ltr">AI_API_KEY</code>{" "}
            (و در صورت نیاز <code className="rounded bg-white px-1 font-mono text-[11px]" dir="ltr">AI_API_BASE_URL</code> /{" "}
            <code className="rounded bg-white px-1 font-mono text-[11px]" dir="ltr">AI_API_MODEL</code>) را در
            Environment Variables سرویس میزبان — مثل Vercel → Settings → Environment Variables — تنظیم کنید و
            سرویس را دوباره Deploy کنید. تا آن زمان هیچ تحلیلی اجرا نمی‌شود، ولی بقیه پنل کار می‌کند.
          </p>
        ) : null}
      </section>

      {/* B. System Prompt */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-950">System Prompt</h2>
          <span className="text-xs text-slate-400">
            {promptChars.toLocaleString("fa-IR")} کاراکتر · تخمین {promptTokensEstimate.toLocaleString("fa-IR")} توکن
          </span>
        </div>
        <textarea
          className="mt-3 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-6 text-slate-800 focus:border-blue-400 focus:outline-none"
          onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })}
          rows={8}
          value={draft.systemPrompt}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <input
            className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="نام این پیکربندی"
            value={draft.name}
          />
          <button
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            onClick={() => setDraft({ ...draft, systemPrompt: DEFAULT_SYSTEM_PROMPT })}
            type="button"
          >
            بازنشانی فقط متن پرامپت
          </button>
        </div>
      </section>

      {/* C. Analysis Features */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6">
        <h2 className="text-base font-bold text-slate-950">ویژگی‌های تحلیل (Analysis Features)</h2>
        <p className="mt-1 text-sm text-slate-500">هر ویژگی به‌طور مستقل قابل فعال/غیرفعال‌سازی و ویرایش است.</p>
        <div className="mt-4 space-y-3">
          {AI_FEATURE_ORDER.map((key) => (
            <AiConfigFeatureRow
              featureKey={key}
              key={key}
              locked={LOCKED_FEATURES.includes(key)}
              onChange={(next) => setDraft({ ...draft, features: { ...draft.features, [key]: next } })}
              value={draft.features[key]}
            />
          ))}
        </div>
      </section>

      {/* D. Decision Rules */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6">
        <h2 className="text-base font-bold text-slate-950">قوانین تصمیم‌گیری (Decision Rules)</h2>
        <p className="mt-1 text-sm text-slate-500">
          این آستانه‌ها فقط به هوش مصنوعی می‌گویند چگونه فیلد <code className="rounded bg-slate-100 px-1">shouldSend</code> را
          پیشنهاد دهد. این پیشنهاد به‌تنهایی هیچ ارسالی انجام نمی‌دهد؛ قوانین ارسال خودکار واقعی جدا و در بخش Agent
          تنظیم می‌شوند.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="حداقل امتیاز اهمیت">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              max={100}
              min={0}
              onChange={(event) =>
                setDraft({ ...draft, decisionRules: { ...draft.decisionRules, minImportanceToSend: Number(event.target.value) } })
              }
              type="number"
              value={draft.decisionRules.minImportanceToSend}
            />
          </Field>
          <Field label="حداقل امتیاز مرتبط بودن">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              max={100}
              min={0}
              onChange={(event) =>
                setDraft({ ...draft, decisionRules: { ...draft.decisionRules, minRelevanceToSend: Number(event.target.value) } })
              }
              type="number"
              value={draft.decisionRules.minRelevanceToSend}
            />
          </Field>
          <Field label="حداقل امتیاز تازگی">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              max={100}
              min={0}
              onChange={(event) =>
                setDraft({ ...draft, decisionRules: { ...draft.decisionRules, minNoveltyToSend: Number(event.target.value) } })
              }
              type="number"
              value={draft.decisionRules.minNoveltyToSend}
            />
          </Field>
          <Field label="آستانه کلی ارسال">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              max={100}
              min={0}
              onChange={(event) =>
                setDraft({ ...draft, decisionRules: { ...draft.decisionRules, overallSendThreshold: Number(event.target.value) } })
              }
              type="number"
              value={draft.decisionRules.overallSendThreshold}
            />
          </Field>
        </div>

        <label className="mt-4 inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            checked={draft.decisionRules.enableAutoRecommendation}
            className="h-4 w-4 accent-blue-600"
            onChange={(event) =>
              setDraft({ ...draft, decisionRules: { ...draft.decisionRules, enableAutoRecommendation: event.target.checked } })
            }
            type="checkbox"
          />
          فعال‌سازی پیشنهاد خودکار هوش مصنوعی (shouldSend)
        </label>
      </section>

      {/* E1. Topic Filter (pre-AI relevance gate) */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-950">موضوعات و فیلتر مرتبط‌سازی (Topic Filter)</h2>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
            <input
              checked={draft.topicFilter?.enabled ?? false}
              className="h-4 w-4 accent-blue-600"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  topicFilter: { ...(draft.topicFilter ?? DEFAULT_TOPIC_FILTER), enabled: event.target.checked },
                })
              }
              type="checkbox"
            />
            فعال‌سازی فیلتر موضوعی
          </label>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          پیش از مرحله پرهزینه تحلیل هوش مصنوعی، اخبار با قواعد ساده کلیدواژه‌ای غربال می‌شوند. اخبار نامرتبط ذخیره اما
          با وضعیت «خارج از موضوع» علامت‌گذاری می‌شوند و هرگز به AI ارسال نمی‌شوند (قابل بازگشت به صف از مدیریت اخبار).
          وقتی فیلتر غیرفعال یا بدون کلیدواژه باشد، همه اخبار رد می‌شوند (هیچ خبری از دست نمی‌رود).
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Field label="حالت فیلتر">
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  topicFilter: {
                    ...(draft.topicFilter ?? DEFAULT_TOPIC_FILTER),
                    mode: event.target.value === "exclude" ? "exclude" : "include",
                  },
                })
              }
              value={draft.topicFilter?.mode ?? "include"}
            >
              <option value="include">تمرکز (فقط اخبار مرتبط با موضوعات)</option>
              <option value="exclude">حذف (کنار گذاشتن اخبار موضوعات زیر)</option>
            </select>
          </Field>
          <button
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
            onClick={() =>
              setDraft({
                ...draft,
                topicFilter: {
                  ...(draft.topicFilter ?? DEFAULT_TOPIC_FILTER),
                  enabled: true,
                  topics: [
                    ...(draft.topicFilter?.topics ?? []),
                    { id: crypto.randomUUID(), label: "", enabled: true, keywords: [] },
                  ],
                },
              })
            }
            type="button"
          >
            + افزودن موضوع سفارشی
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-slate-500">افزودن سریع موضوعات پیشنهادی:</span>
          {TOPIC_PRESETS.map((preset) => (
            <button
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
              key={preset.label}
              onClick={() =>
                setDraft({
                  ...draft,
                  topicFilter: {
                    ...(draft.topicFilter ?? DEFAULT_TOPIC_FILTER),
                    enabled: true,
                    topics: [
                      ...(draft.topicFilter?.topics ?? []),
                      { id: crypto.randomUUID(), label: preset.label, enabled: true, keywords: [...preset.keywords] },
                    ],
                  },
                })
              }
              type="button"
            >
              + {preset.label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {(draft.topicFilter?.topics ?? []).length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center text-sm text-slate-400">
              هنوز موضوعی تعریف نشده است. تا زمانی که موضوعی با کلیدواژه نداشته باشید، فیلتری اعمال نمی‌شود.
            </p>
          ) : (
            (draft.topicFilter?.topics ?? []).map((topic, index) => (
              <AiConfigTopicRow
                key={topic.id || index}
                onChange={(next) => {
                  const topics = [...(draft.topicFilter?.topics ?? [])];
                  topics[index] = next;
                  setDraft({ ...draft, topicFilter: { ...(draft.topicFilter ?? DEFAULT_TOPIC_FILTER), topics } });
                }}
                onRemove={() => {
                  const topics = (draft.topicFilter?.topics ?? []).filter((_, i) => i !== index);
                  setDraft({ ...draft, topicFilter: { ...(draft.topicFilter ?? DEFAULT_TOPIC_FILTER), topics } });
                }}
                value={topic}
              />
            ))
          )}
        </div>
      </section>

      {/* E2. Auto-send policy (Agent / Bale delivery conditions) */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-950">سیاست ارسال خودکار (Agent / بله)</h2>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
            <input
              checked={draft.autoSendPolicy?.useCustom ?? false}
              className="h-4 w-4 accent-blue-600"
              onChange={(event) =>
                setDraft({
                  ...draft,
                  autoSendPolicy: { ...(draft.autoSendPolicy ?? DEFAULT_AUTO_SEND_POLICY), useCustom: event.target.checked },
                })
              }
              type="checkbox"
            />
            استفاده از تنظیمات این بخش (به‌جای متغیرهای محیطی)
          </label>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          شرایط ارسال خودکار تحلیل‌شده‌ها به مقصد بله/Local. تا وقتی گزینه بالا فعال نیست، رفتار تاریخی سامانه (متغیرهای
          محیطی <code className="rounded bg-slate-100 px-1">AUTO_SEND_*</code>) حفظ می‌شود. با فعال‌سازی، مقادیر زیر روی
          نسخه پیکربندی ذخیره و قابل ردیابی می‌شوند.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="ارسال خودکار">
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              disabled={!draft.autoSendPolicy?.useCustom}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  autoSendPolicy: {
                    ...(draft.autoSendPolicy ?? DEFAULT_AUTO_SEND_POLICY),
                    enabled: event.target.value === "true",
                  },
                })
              }
              value={String(draft.autoSendPolicy?.enabled ?? true)}
            >
              <option value="true">روشن</option>
              <option value="false">خاموش</option>
            </select>
          </Field>
          <Field label="مقصد ارسال">
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              disabled={!draft.autoSendPolicy?.useCustom}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  autoSendPolicy: {
                    ...(draft.autoSendPolicy ?? DEFAULT_AUTO_SEND_POLICY),
                    destination: event.target.value as AiAutoSendPolicy["destination"],
                  },
                })
              }
              value={draft.autoSendPolicy?.destination ?? "local"}
            >
              <option value="local">Local</option>
              <option value="bale">بله (Bale)</option>
              <option value="both">Local و بله</option>
            </select>
          </Field>
          <Field label="حداقل اهمیت (۰-۱۰۰)">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              disabled={!draft.autoSendPolicy?.useCustom}
              max={100}
              min={0}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  autoSendPolicy: {
                    ...(draft.autoSendPolicy ?? DEFAULT_AUTO_SEND_POLICY),
                    minImportance: Number(event.target.value),
                  },
                })
              }
              type="number"
              value={draft.autoSendPolicy?.minImportance ?? 50}
            />
          </Field>
          <Field label="حداقل مرتبط بودن (۰-۱۰۰)">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              disabled={!draft.autoSendPolicy?.useCustom}
              max={100}
              min={0}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  autoSendPolicy: {
                    ...(draft.autoSendPolicy ?? DEFAULT_AUTO_SEND_POLICY),
                    minRelevance: Number(event.target.value),
                  },
                })
              }
              type="number"
              value={draft.autoSendPolicy?.minRelevance ?? 50}
            />
          </Field>
          <Field label="حداقل تازگی (۰-۱۰۰)">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              disabled={!draft.autoSendPolicy?.useCustom}
              max={100}
              min={0}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  autoSendPolicy: {
                    ...(draft.autoSendPolicy ?? DEFAULT_AUTO_SEND_POLICY),
                    minNovelty: Number(event.target.value),
                  },
                })
              }
              type="number"
              value={draft.autoSendPolicy?.minNovelty ?? 0}
            />
          </Field>
          <Field label="سقف اخبار هر نوبت (۱-۱۰۰)">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              disabled={!draft.autoSendPolicy?.useCustom}
              max={100}
              min={1}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  autoSendPolicy: {
                    ...(draft.autoSendPolicy ?? DEFAULT_AUTO_SEND_POLICY),
                    maxItemsPerPass: Number(event.target.value),
                  },
                })
              }
              type="number"
              value={draft.autoSendPolicy?.maxItemsPerPass ?? 20}
            />
          </Field>
          <Field label="دسته‌های مجاز (جدا با ویرگول؛ خالی = همه)">
            <input
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              disabled={!draft.autoSendPolicy?.useCustom}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  autoSendPolicy: {
                    ...(draft.autoSendPolicy ?? DEFAULT_AUTO_SEND_POLICY),
                    categories: event.target.value
                      .split(/[,،]/)
                      .map((category) => category.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder="مثال: اقتصاد، بازار"
              value={(draft.autoSendPolicy?.categories ?? []).join("، ")}
            />
          </Field>
          <Field label="الزام پیشنهاد AI (shouldSend)">
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              disabled={!draft.autoSendPolicy?.useCustom}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  autoSendPolicy: {
                    ...(draft.autoSendPolicy ?? DEFAULT_AUTO_SEND_POLICY),
                    requireAiRecommendation: event.target.value === "true",
                  },
                })
              }
              value={String(draft.autoSendPolicy?.requireAiRecommendation ?? false)}
            >
              <option value="false">خیر</option>
              <option value="true">بله</option>
            </select>
          </Field>
        </div>
      </section>

      {/* F. Output Schema */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6">
        <h2 className="text-base font-bold text-slate-950">ساختار خروجی (Output Schema)</h2>
        <p className="mt-1 text-sm text-slate-500">فیلدهای مورد انتظار در پاسخ JSON هوش مصنوعی.</p>
        <div className="mt-4 space-y-2">
          {draft.outputSchema.map((field, index) => (
            <AiConfigOutputFieldRow
              key={field.name}
              locked={LOCKED_FEATURES.includes(field.name)}
              onChange={(next) => {
                const updated = [...draft.outputSchema];
                updated[index] = next;
                setDraft({ ...draft, outputSchema: updated });
              }}
              value={field}
            />
          ))}
        </div>
      </section>

      {/* G. Publishing Template (Milestone 8) */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-slate-950">قالب انتشار (Publishing Template)</h2>
          <button
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            onClick={() => setDraft({ ...draft, publishingTemplate: DEFAULT_PUBLISHING_TEMPLATE })}
            type="button"
          >
            بازنشانی قالب پیش‌فرض
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          ظاهری که خبر تحلیل‌شده با آن ارسال می‌شود. این متن روی همان نسخه پیکربندی ذخیره می‌شود؛ تغییر آن
          خلاصه، امتیازها یا تحلیل خبر را دست نمی‌کند و هیچ ارسال خودکاری انجام نمی‌دهد.
        </p>
        <textarea
          className="mt-3 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-xs leading-6 text-slate-800 focus:border-blue-400 focus:outline-none"
          dir="rtl"
          onChange={(event) => setDraft({ ...draft, publishingTemplate: event.target.value })}
          rows={10}
          value={draft.publishingTemplate}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-slate-500">متغیرها:</span>
          {PUBLISHING_TEMPLATE_VARS.map((name) => (
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600" key={name}>
              {`{${name}}`}
            </code>
          ))}
        </div>
        {unknownTemplateVars.length > 0 ? (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            متغیر ناشناخته: {unknownTemplateVars.map((name) => `{${name}}`).join("، ")} — این‌ها در پیام نهایی باقی
            می‌مانند و مقدارگیری نمی‌شوند.
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-slate-400">
          خالی گذاشتن این فیلد یعنی استفاده از چیدمان داخلی قبلی (سازگاری با پیکربندی‌های پیشین).
        </p>
      </section>

      {/* Test Configuration */}
      <AiConfigTestPanel adminKey={adminKey} draftConfig={draft} />

      {/* Version History */}
      <AiConfigVersionHistory
        activating={activatingId}
        loading={versionsLoading}
        onActivate={handleActivateVersion}
        versions={versions}
      />

      {/* Validation feedback + action buttons */}
      <section className="sticky bottom-4 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur sm:p-5">
        {saveErrors.length > 0 ? (
          <ul className="mb-3 space-y-1 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            {saveErrors.map((error, index) => (
              <li key={index}>• {error}</li>
            ))}
          </ul>
        ) : null}
        {saveSuccess ? (
          <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{saveSuccess}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            disabled={saving !== null}
            onClick={() => handleSave(true)}
            type="button"
          >
            {saving === "activate" ? "در حال ذخیره..." : "ذخیره و فعال‌سازی"}
          </button>
          <button
            className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-2.5 text-sm font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saving !== null}
            onClick={() => handleSave(false)}
            type="button"
          >
            {saving === "draft" ? "در حال ذخیره..." : "ذخیره به‌عنوان پیش‌نویس"}
          </button>
          <button
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
            disabled={saving !== null}
            onClick={handleResetToDefault}
            type="button"
          >
            بازنشانی به پیش‌فرض
          </button>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
