"use client";

import { AI_FEATURE_LABELS, type AiFeatureConfig, type AiFeatureKey } from "@/lib/ai/config-types";

type Props = {
  featureKey: AiFeatureKey;
  value: AiFeatureConfig;
  locked?: boolean;
  onChange: (next: AiFeatureConfig) => void;
};

/**
 * One row = one configurable AI feature (Summary, Category, Importance Score, ...).
 * `locked` disables the enable/disable toggle for fields the pipeline always
 * requires (summary, shouldSend) — editing the instruction text is still allowed.
 */
export function AiConfigFeatureRow({ featureKey, value, locked, onChange }: Props) {
  const isScore = value.scaleMin !== undefined && value.scaleMax !== undefined;

  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[auto_1fr] sm:items-start">
      <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2">
          <input
            checked={value.enabled}
            className="h-4 w-4 accent-blue-600 disabled:cursor-not-allowed"
            disabled={locked}
            onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
            type="checkbox"
          />
          <span className="text-sm font-bold text-slate-900">{AI_FEATURE_LABELS[featureKey]}</span>
        </label>
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-500">
          {featureKey}
        </span>
        {locked ? (
          <span className="text-[11px] text-amber-600">همیشه فعال (الزامی برای عملکرد سامانه)</span>
        ) : null}
      </div>

      <div className="space-y-2">
        <textarea
          className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
          disabled={!value.enabled}
          onChange={(event) => onChange({ ...value, instruction: event.target.value })}
          placeholder="دستورالعمل این ویژگی را بنویسید..."
          rows={2}
          value={value.instruction}
        />

        {isScore ? (
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>بازه امتیاز:</span>
            <input
              className="w-16 rounded-md border border-slate-200 px-2 py-1 text-center disabled:bg-slate-50"
              disabled={!value.enabled}
              min={0}
              onChange={(event) => onChange({ ...value, scaleMin: Number(event.target.value) })}
              type="number"
              value={value.scaleMin ?? 0}
            />
            <span>تا</span>
            <input
              className="w-16 rounded-md border border-slate-200 px-2 py-1 text-center disabled:bg-slate-50"
              disabled={!value.enabled}
              min={0}
              onChange={(event) => onChange({ ...value, scaleMax: Number(event.target.value) })}
              type="number"
              value={value.scaleMax ?? 100}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
