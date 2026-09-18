import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isAdminAccessConfigured } from "@/lib/admin/access";
import { isNextProductionBuild } from "@/db";
import { getAdminNewsDetail } from "@/lib/news/news-admin";
import { publishStatusLabel, publishingStatusTone } from "@/lib/delivery/types";
import { NewsAdminActions } from "@/components/admin/news-admin-actions";
import { NewsStatusTones } from "@/components/admin/news-status-pill";
import { Sidebar } from "@/components/sidebar";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "جزئیات خبر | مدیریت اخبار",
  description: "داده خام، پردازش و تاریخچه تحلیل هوش مصنوعی",
};

type PageProps = {
  params: Promise<{ id: string }> | { id: string };
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatFull(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("fa-IR");
}

export default async function AdminNewsDetailPage({ params, searchParams }: PageProps) {
  const resolvedParams = "then" in params ? await params : params;
  const sp = await searchParams;
  const providedKeyRaw = sp.key;
  const providedKey = Array.isArray(providedKeyRaw) ? providedKeyRaw[0] : providedKeyRaw;

  const requiredKey = process.env.ADMIN_ACCESS_KEY?.trim();
  const gateConfigured = isAdminAccessConfigured();
  const authorized = !gateConfigured || (requiredKey && providedKey?.trim() === requiredKey);

  if (!authorized || isNextProductionBuild) {
    notFound();
  }

  const detail = await getAdminNewsDetail(resolvedParams.id);
  if (!detail) notFound();

  const { item } = detail;
  const latest = detail.analyses.find((analysis) => analysis.status === "success") ?? null;

  return (
    <div dir="rtl" className="min-h-screen bg-[#f8fafc] text-slate-900">
      <div className="lg:flex">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1180px] space-y-6 p-4 sm:p-6 lg:p-10">
            <header>
              <Link className="text-sm font-medium text-blue-700 hover:underline" href="/admin/news">
                → بازگشت به فهرست اخبار
              </Link>
              <h1 className="mt-3 text-2xl font-bold leading-9 tracking-tight text-slate-950">{item.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <NewsStatusTones status={item.status} />
                <span>منبع: {detail.sourceName ?? item.source}</span>
                <span>· شناسه خبر: <code className="font-mono text-[10px]">{item.id.slice(0, 8)}</code></span>
              </div>
            </header>

            <NewsAdminActions adminKey={gateConfigured ? providedKey?.trim() ?? "" : ""} newsId={item.id} status={item.status} />

            {detail.duplicateOf ? (
              <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                این رکورد به‌عنوان تکراری علامت‌گذاری شده است.{" "}
                <Link className="font-bold underline" href={`/admin/news/${detail.duplicateOf.id}`}>
                  مشاهده خبر اصلی
                </Link>
              </p>
            ) : null}

            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">اطلاعات منبع (داده خام)</h2>
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <Row label="آدرس اصلی" value={<a className="break-all text-blue-700 hover:underline" dir="ltr" href={item.url} rel="noopener noreferrer nofollow" target="_blank">{item.url}</a>} />
                <Row label="آدرس کانونیکال (بدون پارامترهای ردیابی)" value={<span className="break-all font-mono text-xs" dir="ltr">{item.canonicalUrl ?? "—"}</span>} />
                <Row label="شناسه خارجی (guid)" value={item.externalId ?? "—"} />
                <Row label="نویسنده" value={item.author ?? "—"} />
                <Row label="تاریخ انتشار" value={formatFull(item.publishedAt ? item.publishedAt.toISOString() : null)} />
                <Row label="تاریخ دریافت" value={formatFull(item.fetchedAt.toISOString())} />
              </dl>
            </section>

            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">مقاله</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-slate-700">
                <div>
                  <p className="text-xs font-bold text-slate-400">عنوان (خام):</p>
                  <p>{item.title}</p>
                </div>
                {item.description ? (
                  <div>
                    <p className="text-xs font-bold text-slate-400">توضیح (خام):</p>
                    <p>{item.description}</p>
                  </div>
                ) : null}
                {item.content ? (
                  <div>
                    <p className="text-xs font-bold text-slate-400">محتوای کامل (خام):</p>
                    <p className="max-h-64 overflow-y-auto whitespace-pre-wrap">{item.content}</p>
                  </div>
                ) : null}
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" className="max-h-72 rounded-xl object-cover" src={item.imageUrl} />
                ) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">پردازش (نسخه نجارسازی‌شده)</h2>
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-bold text-slate-400">عنوان نرمال‌شده:</dt>
                  <dd className="mt-1">{item.normalizedTitle ?? item.title}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold text-slate-400">محتوای نرمال‌شده:</dt>
                  <dd className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-slate-600">
                    {item.normalizedContent ?? item.description ?? "—"}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-6 text-xs text-slate-500">
                  <span>ساخت: {formatFull(item.createdAt.toISOString())}</span>
                  <span>به‌روزرسانی: {formatFull(item.updatedAt.toISOString())}</span>
                </div>
              </dl>
            </section>

            <section className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">تحلیل هوش مصنوعی (آخرین نتیجه)</h2>
              {latest ? (
                <div className="mt-3 space-y-3 text-sm">
                  <p className="leading-7 text-slate-800">{latest.summary}</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-bold text-indigo-700">دسته: {latest.category ?? "—"}</span>
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 text-slate-600">اهمیت: {latest.importance ?? "—"}</span>
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 text-slate-600">مرتبط بودن: {latest.relevance ?? "—"}</span>
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 text-slate-600">تازگی: {latest.novelty ?? "—"}</span>
                    <StatusBadge tone={latest.shouldSend ? "success" : "muted"}>{latest.shouldSend ? "پیشنهاد ارسال: بله" : "پیشنهاد ارسال: خیر"}</StatusBadge>
                  </div>
                  {latest.mainEvent ? <p className="text-xs text-slate-500">رویداد اصلی: {latest.mainEvent}</p> : null}
                  {latest.reason ? <p className="text-xs text-slate-500">دلیل: {latest.reason}</p> : null}
                  <p className="text-[11px] text-slate-400">
                    پیکربندی نسخه {latest.configurationVersion ?? "—"} · مدل {latest.model ?? "—"} · {formatFull(latest.createdAt)}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">هنوز تحلیل موفقی برای این خبر ثبت نشده است.</p>
              )}

              {detail.analyses.length > 0 ? (
                <details className="mt-4 border-t border-slate-100 pt-3">
                  <summary className="cursor-pointer text-xs font-bold text-slate-600">
                    تاریخچه کامل تحلیل‌ها ({detail.analyses.length} مورد — قدیمی‌ترین‌ها هرگز بازنویسی نمی‌شوند)
                  </summary>
                  <ul className="mt-3 space-y-2">
                    {detail.analyses.map((analysis, index) => (
                      <li className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-xs" key={analysis.id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-700">AI Analysis v{detail.analyses.length - index}</span>
                          <StatusBadge tone={analysis.status === "success" ? "success" : "danger"}>
                            {analysis.status === "success" ? "موفق" : "ناموفق"}
                          </StatusBadge>
                          <span className="text-slate-400">{formatFull(analysis.createdAt)}</span>
                          <span className="text-slate-400">config v{analysis.configurationVersion ?? "?"} · {analysis.model ?? "—"}</span>
                        </div>
                        {analysis.status === "success" ? (
                          <p className="mt-1.5 text-slate-600">
                            {analysis.summary?.slice(0, 140)}… — اهمیت {analysis.importance}، ارسال {analysis.shouldSend ? "بله" : "خیر"}
                          </p>
                        ) : (
                          <p className="mt-1.5 text-rose-600" dir="auto">{analysis.errorMessage}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>

            <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-slate-900">ارسال و انتشار</h2>
                <span className="text-[11px] text-slate-400">تصمیم AI و وضعیت ارسال، دو چیز جدا از هم هستند</span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                <span className="font-bold text-slate-500">تصمیم AI:</span>
                {item.shouldSend === true ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-bold text-emerald-700 ring-1 ring-emerald-200">✓ باید ارسال شود</span>
                ) : item.shouldSend === false ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 font-bold text-slate-500">✕ توصیه نشده</span>
                ) : (
                  <span className="text-slate-400">— تحلیل موجود نیست</span>
                )}
                <span className="font-bold text-slate-500">وضعیت خبر:</span>
                <NewsStatusTones status={item.status} />
              </div>

              {detail.deliveryAttempts.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-3 text-xs text-slate-500">
                  هنوز نامزد ارسال برای این خبر ساخته نشده است.
                  {item.shouldSend === true
                    ? " با «ساخت نامزد ارسال»، یک رکورد در وضعیت «در انتظار تأیید» می‌سازید (هیچ پیامی ارسال نمی‌شود)."
                    : " برای ارسال برخلاف نظر AI، باید override با دلیل ثبت کنید."}
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {detail.deliveryAttempts.map((attempt) => (
                    <li className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2" key={attempt.id}>
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <StatusBadge tone={publishingStatusTone(attempt.status)}>{publishStatusLabel(attempt.status)}</StatusBadge>
                        <span className="font-bold text-slate-600">{attempt.destination === "bale" ? "بله" : "Local"}</span>
                        <span className="text-slate-400">{attempt.triggeredBy === "auto" ? "خودکار 🤖" : "دستی 👤"}</span>
                        {attempt.overrideRequested ? (
                          <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 ring-1 ring-violet-200">override</span>
                        ) : null}
                        {attempt.retryCount > 0 ? <span className="text-[10px] text-slate-400">تلاش: {attempt.retryCount}</span> : null}
                        <span className="text-slate-400">{formatFull(attempt.createdAt)}</span>
                        <Link className="ms-auto font-bold text-blue-700 hover:underline" href={`/admin/deliveries/${attempt.id}`}>
                          جزئیات ←
                        </Link>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                        {attempt.sentAt ? <span>✓ ارسال‌شده در {formatFull(attempt.sentAt)}</span> : null}
                        {attempt.providerMessageId ? (
                          <span>
                            شناسه پیام بله: <code className="font-mono" dir="ltr">{attempt.providerMessageId}</code>
                          </span>
                        ) : null}
                        {attempt.errorMessage ? <span className="text-rose-600">{attempt.errorMessage.slice(0, 90)}</span> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-50 pb-1.5">
      <dt className="shrink-0 text-xs font-bold text-slate-400">{label}</dt>
      <dd className="text-left text-slate-700">{value}</dd>
    </div>
  );
}
