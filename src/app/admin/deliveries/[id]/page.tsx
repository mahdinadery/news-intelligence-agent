import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isNextProductionBuild } from "@/db";
import { AdminGateScreen } from "@/components/admin/admin-gate-screen";
import { AdminKeyQuerySync } from "@/components/admin/admin-key-query-sync";
import { AdminPageErrorShell } from "@/components/admin/admin-page-error-shell";
import { adminKeyForClient, getAdminPageAccess } from "@/lib/admin/page-access";
import { runWithSchemaRepair } from "@/lib/admin/schema-sync";
import { getDeliveryDetail } from "@/lib/delivery/publishing";
import { publishStatusLabel, publishingStatusTone } from "@/lib/delivery/types";
import { DeliveryActions } from "@/components/admin/delivery-actions";
import { Sidebar } from "@/components/sidebar";
import { StatusBadge } from "@/components/status-badge";
import { DELIVERY_EVENT_LABELS } from "@/lib/delivery/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "جزئیات ارسال | انتشار اخبار",
  description: "تأیید انسانی، ویرایش پیام و تاریخچه ارسال",
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

export default async function AdminDeliveryDetailPage({ params, searchParams }: PageProps) {
  const resolvedParams = "then" in params ? await params : params;
  const sp = await searchParams;
  const providedKeyRaw = sp.key;
  const providedKey = Array.isArray(providedKeyRaw) ? providedKeyRaw[0] : providedKeyRaw;

  if (isNextProductionBuild) notFound();

  const access = await getAdminPageAccess(providedKey);
  if (!access.authorized) {
    return <AdminGateScreen width="narrow" />;
  }

  const clientKey = adminKeyForClient(access);

  const outcome = await runWithSchemaRepair(() => getDeliveryDetail(resolvedParams.id));
  if (!outcome.ok) {
    return (
      <AdminPageErrorShell
        adminKey={clientKey}
        error={outcome.error}
        message="بارگذاری جزئیات ارسال از پایگاه داده ناموفق بود."
      />
    );
  }

  const detail = outcome.value;
  if (!detail) notFound();

  const { delivery, article, analysis, events } = detail;
  const backHref = `/admin/deliveries${clientKey ? `?key=${encodeURIComponent(clientKey)}` : ""}`;

  return (
    <div dir="rtl" className="min-h-screen bg-[#f8fafc] text-slate-900">
      <div className="lg:flex">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1180px] space-y-6 p-4 sm:p-6 lg:p-10">
            <AdminKeyQuerySync adminKey={clientKey} />
            <header>
              <Link className="text-sm font-medium text-blue-700 hover:underline" href={backHref}>
                → بازگشت به فهرست ارسال‌ها
              </Link>
              <h1 className="mt-3 text-2xl font-bold leading-9 tracking-tight text-slate-950">{article.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <StatusBadge tone={publishingStatusTone(delivery.status)}>{publishStatusLabel(delivery.status)}</StatusBadge>
                <span>مقصد: {delivery.destination === "bale" ? "بله" : "Local"}</span>
                <span>· شروع‌کننده: {delivery.triggeredBy === "auto" ? "قوانین خودکار" : "دستی"}</span>
              </div>
            </header>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="خبر">
                <dl className="space-y-2 text-sm">
                  <Row label="منبع" value={article.source} />
                  <Row
                    label="آدرس اصلی"
                    value={
                      <a className="break-all text-blue-700 hover:underline" dir="ltr" href={article.url} rel="noopener noreferrer nofollow" target="_blank">
                        {article.url}
                      </a>
                    }
                  />
                  <Row label="تاریخ انتشار" value={article.publishedAt ? formatFull(article.publishedAt.toISOString()) : "—"} />
                  <Row label="تاریخ دریافت" value={formatFull(article.fetchedAt.toISOString())} />
                  <Row label="وضعیت خبر" value={article.status} />
                </dl>
                {article.summary ? (
                  <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm leading-7 text-slate-700">{article.summary}</p>
                ) : null}
              </Card>

              <Card title="تحلیل AI (معتبر برای این ارسال)">
                {analysis ? (
                  <>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 font-bold text-slate-600">
                        پیکربندی نسخه {analysis.configurationVersion ?? "—"}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-slate-600" dir="ltr">
                        {analysis.model ?? "—"}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{formatFull(analysis.createdAt.toISOString())}</span>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-slate-800">{analysis.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Chip>دسته: {analysis.category ?? "—"}</Chip>
                      <Chip>اهمیت: {analysis.importance ?? "—"}</Chip>
                      <Chip>مرتبط بودن: {analysis.relevance ?? "—"}</Chip>
                      <Chip>تازگی: {analysis.novelty ?? "—"}</Chip>
                    </div>
                    {analysis.mainEvent ? <p className="mt-2 text-xs text-slate-500">رویداد اصلی: {analysis.mainEvent}</p> : null}
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-500">تصمیم AI:</span>
                      <StatusBadge tone={analysis.shouldSend ? "success" : "muted"}>
                        {analysis.shouldSend ? "باید ارسال شود" : "عدم توصیه ارسال"}
                      </StatusBadge>
                    </div>
                    {analysis.reason ? <p className="mt-1 text-xs leading-6 text-slate-500">دلیل: {analysis.reason}</p> : null}
                  </>
                ) : (
                  <p className="text-sm text-slate-400">
                    این رکورد به یک تحلیل خاص لینک نشده است (رکوردهای پیش از این milestone) — متن خبر همان چیزی است که
                    پایین‌تر در «متن پیام» می‌بینید.
                  </p>
                )}
              </Card>
            </div>

            <Card title="متن پیام (محصول نهایی انتشار)">
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-800 ring-1 ring-slate-100">
                {delivery.message ?? "—"}
              </pre>
              <p className="mt-2 text-[11px] text-slate-400">
                این متن یک اثر مستقل انتشار است؛ ویرایش آن عنوان خبر، خلاصه AI و امتیازها را تغییر نمی‌دهد.
              </p>
            </Card>

            <DeliveryActions
              adminKey={clientKey}
              canRetry={!delivery.providerMessageId && !delivery.sentAt}
              deliveryId={delivery.id}
              destination={delivery.destination}
              message={delivery.message ?? ""}
              status={delivery.status}
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="وضعیت انتشار">
                <dl className="space-y-2 text-sm">
                  <Row label="ساخته‌شده" value={formatFull(delivery.createdAt.toISOString())} />
                  <Row label="تأیید توسط" value={delivery.approvedBy ?? "—"} />
                  <Row label="زمان تأیید" value={delivery.approvedAt ? formatFull(delivery.approvedAt.toISOString()) : "—"} />
                  <Row label="زمان ارسال" value={delivery.sentAt ? formatFull(delivery.sentAt.toISOString()) : "—"} />
                  <Row label="شناسه پیام بله" value={delivery.providerMessageId ? <code className="font-mono text-xs" dir="ltr">{delivery.providerMessageId}</code> : "—"} />
                  <Row label="تعداد تلاش مجدد" value={String(delivery.retryCount ?? 0)} />
                  {delivery.overrideRequested ? (
                    <Row label="override" value={<span className="font-bold text-violet-700">{delivery.overrideReason ?? "ثبت شده"}</span>} />
                  ) : null}
                  {delivery.errorMessage ? <Row label="آخرین خطا" value={<span className="text-rose-700">{delivery.errorMessage}</span>} /> : null}
                </dl>
              </Card>

              <Card title="تاریخچه اقدامات">
                {events.length === 0 ? (
                  <p className="text-sm text-slate-400">رویدادی ثبت نشده است.</p>
                ) : (
                  <ul className="space-y-2">
                    {events.map((event) => (
                      <li className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-xs" key={event.id}>
                        <span className="font-bold text-slate-700">{DELIVERY_EVENT_LABELS[event.event] ?? event.event}</span>
                        <span className="text-slate-400">{formatFull(event.createdAt.toISOString())}</span>
                        {event.actor ? <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{event.actor}</span> : null}
                        {event.detail ? <span className="w-full break-words text-[11px] text-slate-500">{event.detail}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <p className="text-[11px] leading-5 text-slate-400">
              ارسال فقط با کلیک انجام می‌شود؛ هیچ ارسال خودکاری برای مسیر تأیید انسانی فعال نیست. اعتبارنامه‌های بله
              هرگز در این صفحه یا پاسخ API نمایش داده نمی‌شوند.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-50 pb-1.5 last:border-0">
      <dt className="shrink-0 text-xs font-bold text-slate-400">{label}</dt>
      <dd className="text-left text-slate-700">{value}</dd>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-bold text-indigo-700 ring-1 ring-indigo-100">{children}</span>;
}
