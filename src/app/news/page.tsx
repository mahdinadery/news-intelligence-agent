import { isNextProductionBuild } from "@/db";
import { getNewsStats, listLatestNews, type NewsListItem, type NewsStats } from "@/lib/news/ingest";
import { getDeliveryStates } from "@/lib/delivery";
import { NewsList, type NewsDeliveryStates } from "@/components/news-list";
import { NewsRefreshButton } from "@/components/news-refresh-button";
import { Sidebar } from "@/components/sidebar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "اخبار | دستیار هوشمند اخبار",
  description: "فهرست اخبار دریافت‌شده، تحلیل هوشمند و وضعیت ارسال",
};

type LoadResult = {
  items: NewsListItem[];
  stats: NewsStats | null;
  deliveryStates: NewsDeliveryStates;
  error: boolean;
};

async function loadNews(): Promise<LoadResult> {
  // Never open a socket during `next build`; the page is dynamic at runtime.
  if (isNextProductionBuild) {
    return { items: [], stats: null, deliveryStates: {}, error: false };
  }

  try {
    const [items, stats] = await Promise.all([listLatestNews(60), getNewsStats()]);
    const deliveryStates = await getDeliveryStates(items.map((item) => item.id));
    return { items, stats, deliveryStates, error: false };
  } catch {
    return { items: [], stats: null, deliveryStates: {}, error: true };
  }
}

export default async function NewsPage() {
  const { items, stats, deliveryStates, error } = await loadNews();

  const analyzedCount = items.filter((item) => item.analyzedAt).length;
  const sentCount = items.filter((item) => {
    const state = deliveryStates[item.id];
    return state?.local === "sent" || state?.bale === "sent";
  }).length;

  return (
    <div dir="rtl" className="min-h-screen bg-[#f8fafc] text-slate-900">
      <div className="lg:flex">
        <Sidebar />

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1180px] p-4 sm:p-6 lg:p-10">
            <header className="flex flex-col gap-5 border-b border-slate-200/80 pb-7 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="mb-3 text-sm font-medium text-blue-600">کتابخانه اخبار</p>
                <h1 className="text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">اخبار</h1>
                <p className="mt-2 text-sm text-slate-500">
                  دریافت، تحلیل هوشمند و ارسال خبرها — هر مرحله جدا و با دستور کاربر انجام می‌شود
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm shadow-slate-200/40">
                  <p className="text-xs text-slate-500">نمایش</p>
                  <p className="mt-1 text-lg font-bold text-slate-950">{items.length}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm shadow-slate-200/40">
                  <p className="text-xs text-slate-500">تحلیل‌شده</p>
                  <p className="mt-1 text-lg font-bold text-slate-950">{analyzedCount}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm shadow-slate-200/40">
                  <p className="text-xs text-slate-500">ارسال‌شده</p>
                  <p className="mt-1 text-lg font-bold text-slate-950">{sentCount}</p>
                </div>
                <NewsRefreshButton />
              </div>
            </header>

            {error ? (
              <p className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
                خواندن اخبار از پایگاه داده ناموفق بود. لطفاً بعداً دوباره تلاش کنید.
              </p>
            ) : null}

            {stats && stats.totalStored > items.length ? (
              <p className="mt-6 text-xs text-slate-400">
                {items.length} خبر از {stats.totalStored} خبر ذخیره‌شده نمایش داده می‌شود.
              </p>
            ) : null}

            <section aria-label="فهرست اخبار" className="mt-7">
              <NewsList deliveryStates={deliveryStates} items={items} />
            </section>

            <p className="mt-6 text-xs text-slate-400">
              «پیشنهاد ارسال» صرفاً نظر هوش مصنوعی است و هیچ ارسال خودکاری انجام نمی‌شود؛ هر پیام فقط با
              کلیک شما ارسال می‌گردد.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
