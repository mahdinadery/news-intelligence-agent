"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../status-badge";

type EntitySummary = {
  name: string;
  count: number;
  avgImportance: number;
  corroboratedCount: number;
  lastPublishedAt: string | null;
};

type EntityNews = {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  source: string;
  category: string | null;
  importanceScore: number | null;
  relevanceScore: number | null;
  corroborationCount: number;
  relevanceGrade: string | null;
  publishedAt: string | null;
};

type ApiResponse = {
  success: boolean;
  entities?: EntitySummary[];
  stats?: EntitySummary;
  news?: EntityNews[];
  message?: string;
  sent?: boolean;
  itemCount?: number;
  reason?: string | null;
};

function authHeaders(adminKey: string): Record<string, string> {
  return adminKey ? { "x-admin-key": adminKey } : {};
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fa-IR", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function EntitiesConsole({ adminKey = "" }: { adminKey?: string }) {
  const [entities, setEntities] = useState<EntitySummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ stats: EntitySummary; news: EntityNews[] } | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [bulletinBusy, setBulletinBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [loadFailure, setLoadFailure] = useState<string | null>(null);

  // NOTE: no synchronous setState here — the effect below calls load() on
  // mount and react-hooks/set-state-in-effect forbids sync set-state in it.
  const load = useCallback(() => {
    fetch("/api/admin/entities", { headers: authHeaders(adminKey), cache: "no-store" })
      .then((res) => res.json() as Promise<ApiResponse>)
      .then((data) => {
        if (data.success) {
          setEntities(data.entities ?? []);
          setLoadFailure(null);
        } else {
          setLoadFailure(data.message ?? "بارگذاری موجودیت‌ها ناموفق بود.");
        }
      })
      .catch(() => setLoadFailure("ارتباط با سرور برقرار نشد."))
      .finally(() => setLoading(false));
  }, [adminKey]);

  useEffect(() => {
    load();
  }, [load]);

  const loadDetail = useCallback(
    (name: string) => {
      setSelected(name);
      setDetailLoading(true);
      setDetail(null);
      fetch(`/api/admin/entities?name=${encodeURIComponent(name)}`, {
        headers: authHeaders(adminKey),
        cache: "no-store",
      })
        .then((res) => res.json() as Promise<ApiResponse>)
        .then((data) => {
          if (data.success && data.stats) {
            setDetail({ stats: data.stats, news: data.news ?? [] });
          } else {
            setMessage({ kind: "err", text: data.message ?? "خواندن پرونده ناموفق بود." });
          }
        })
        .catch(() => setMessage({ kind: "err", text: "ارتباط با سرور برقرار نشد." }))
        .finally(() => setDetailLoading(false));
    },
    [adminKey],
  );

  const sendBulletin = useCallback(async () => {
    if (!selected || bulletinBusy) return;
    setBulletinBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/entities/bulletin", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(adminKey) },
        body: JSON.stringify({ name: selected }),
      });
      const data = (await response.json()) as ApiResponse;
      if (data.success && data.sent) {
        setMessage({ kind: "ok", text: `بولتن «${selected}» با ${data.itemCount ?? 0} خبر ارسال شد.` });
      } else {
        setMessage({
          kind: "err",
          text: `بولتن ارسال نشد${data.reason ? ` (${data.reason === "no_qualifying_items" ? "خبر واجد شرایط نبود" : data.reason})` : ""}.`,
        });
      }
    } catch {
      setMessage({ kind: "err", text: "ارتباط با سرور برقرار نشد." });
    } finally {
      setBulletinBusy(false);
    }
  }, [adminKey, bulletinBusy, selected]);

  const filtered = useMemo(() => {
    const clean = query.trim();
    if (!clean) return entities;
    return entities.filter((entity) => entity.name.includes(clean));
  }, [entities, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-950">پروندهٔ ناشران و نهادها</h1>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            نام بانک‌ها/شرکت‌ها/نهادهایی که هوش مصنوعی در تحلیل خبرها استخراج کرده است. از هر موجودیت می‌توانید
            «بولتن هفتگی/موردی» همان نهاد را برای کانال بفرستید.
          </p>
        </div>
        <button
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => {
            setLoading(true);
            load();
          }}
          type="button"
        >
          تازه‌سازی
        </button>
      </div>

      {loadFailure ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{loadFailure}</p>
      ) : null}
      {message ? (
        <p
          className={`rounded-xl border px-4 py-3 text-sm ${
            message.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <input
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-sky-300 focus:outline-none"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جست‌وجوی موجودیت..."
            value={query}
          />
          <div className="mt-3 max-h-[560px] space-y-1 overflow-y-auto">
            {loading ? <p className="p-3 text-xs text-slate-400">در حال بارگذاری...</p> : null}
            {!loading && filtered.length === 0 ? (
              <p className="p-3 text-xs leading-6 text-slate-400">
                هنوز موجودیتی استخراج نشده است. خبرهای تحلیل‌شدهٔ جدید به‌صورت خودکار این فهرست را پر می‌کنند.
              </p>
            ) : null}
            {filtered.map((entity) => (
              <button
                key={entity.name}
                className={`w-full rounded-lg border px-3 py-2 text-right text-sm transition ${
                  selected === entity.name
                    ? "border-sky-300 bg-sky-50 text-sky-900"
                    : "border-slate-100 hover:bg-slate-50"
                }`}
                onClick={() => loadDetail(entity.name)}
                type="button"
              >
                <span className="block truncate font-medium">{entity.name}</span>
                <span className="mt-0.5 block text-[11px] text-slate-500">
                  {entity.count.toLocaleString("fa-IR")} خبر · میانگین اهمیت {entity.avgImportance.toLocaleString("fa-IR")}
                  {entity.corroboratedCount > 0 ? ` · ${entity.corroboratedCount.toLocaleString("fa-IR")} تأییدشده` : ""}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-3">
          {!selected ? (
            <p className="p-6 text-center text-sm text-slate-400">یک موجودیت را از فهرست انتخاب کنید.</p>
          ) : detailLoading ? (
            <p className="p-6 text-center text-sm text-slate-400">در حال بارگذاری پرونده...</p>
          ) : detail ? (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-950">{detail.stats.name}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {detail.stats.count.toLocaleString("fa-IR")} خبر تحلیل‌شده · میانگین اهمیت{" "}
                    {detail.stats.avgImportance.toLocaleString("fa-IR")} · آخرین خبر:{" "}
                    {formatDate(detail.stats.lastPublishedAt)}
                  </p>
                </div>
                <button
                  className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                  disabled={bulletinBusy}
                  onClick={sendBulletin}
                  type="button"
                >
                  {bulletinBusy ? "در حال ارسال..." : "ارسال بولتن این موجودیت"}
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {detail.news.map((item) => (
                  <article key={item.id} className="rounded-xl border border-slate-100 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        className="text-sm font-medium text-sky-800 hover:underline"
                        href={item.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {item.title}
                      </a>
                      {(item.corroborationCount ?? 0) >= 2 ? (
                        <StatusBadge tone="success">تأییدشده</StatusBadge>
                      ) : null}
                      {item.relevanceGrade === "rejected" ? (
                        <StatusBadge tone="danger">نامرتبط (گریدر)</StatusBadge>
                      ) : null}
                    </div>
                    {item.summary ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{item.summary}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-slate-400">
                      {item.source} · اهمیت {item.importanceScore ?? "—"} · مرتبط بودن {item.relevanceScore ?? "—"} ·{" "}
                      {formatDate(item.publishedAt)}
                    </p>
                  </article>
                ))}
                {detail.news.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-400">خبری برای این موجودیت پیدا نشد.</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
