"use client";

import type { AiTopicRule } from "@/lib/ai/config-types";

type Props = {
  value: AiTopicRule;
  onChange: (next: AiTopicRule) => void;
  onRemove: () => void;
};

/**
 * One row of the Topic Filter editor (Milestone: dashboard-configurable topics).
 * Keywords are edited as a comma-separated list — plain data, no code changes.
 */
export function AiConfigTopicRow({ value, onChange, onRemove }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          checked={value.enabled}
          className="h-4 w-4 accent-blue-600"
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
          title="فعال/غیرفعال"
          type="checkbox"
        />
        <input
          className="min-w-[160px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
          onChange={(event) => onChange({ ...value, label: event.target.value })}
          placeholder="عنوان موضوع (مثلاً: بازار خودرو)"
          value={value.label}
        />
        <button
          className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50"
          onClick={onRemove}
          type="button"
        >
          حذف موضوع
        </button>
      </div>
      <input
        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
        onChange={(event) =>
          onChange({
            ...value,
            keywords: event.target.value
              .split(/[,،]/)
              .map((keyword) => keyword.trim())
              .filter(Boolean),
          })
        }
        placeholder="کلیدواژه‌ها با جداکننده ویرگول (مثلاً: خودرو، قیمت خودرو، خودروساز)"
        value={value.keywords.join("، ")}
      />
      <p className="mt-1.5 text-[11px] text-slate-400">
        تطبیق با هر یک از کلیدواژه‌ها کافی است (جست‌وجوی ساده متنی، بدون فراخوانی هوش مصنوعی).
      </p>
    </div>
  );
}
