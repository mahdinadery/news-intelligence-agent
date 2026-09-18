"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Explicit, button-driven ingestion for the news page.
 * Reuses the same POST /api/news/fetch endpoint as the dashboard, then refreshes
 * the server-rendered list. Never runs automatically.
 */
export function NewsRefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    setNote(null);

    try {
      const response = await fetch("/api/news/fetch", { method: "POST" });
      const data = (await response.json()) as {
        success: boolean;
        stored?: number;
        fetched?: number;
        duplicates?: number;
        message?: string;
      };

      setNote(
        data.success
          ? `${data.stored ?? 0} خبر جدید ذخیره شد (${data.duplicates ?? 0} تکراری).`
          : (data.message ?? "دریافت اخبار ناموفق بود."),
      );
      router.refresh();
    } catch {
      setNote("دریافت اخبار ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        disabled={busy}
        onClick={handleClick}
        type="button"
      >
        {busy ? "در حال دریافت..." : "دریافت اخبار"}
      </button>
      {note ? <p className="text-xs text-slate-500">{note}</p> : null}
    </div>
  );
}
