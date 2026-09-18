import { isAdminAccessConfigured } from "@/lib/admin/access";
import { NewsSourcesConsole } from "@/components/admin/news-sources-console";
import { Sidebar } from "@/components/sidebar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "مدیریت منابع خبری | دستیار هوشمند اخبار",
  description: "افزودن، تست و پایش سلامت منابع خبری",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewsSourcesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const providedKeyRaw = params.key;
  const providedKey = Array.isArray(providedKeyRaw) ? providedKeyRaw[0] : providedKeyRaw;

  const requiredKey = process.env.ADMIN_ACCESS_KEY?.trim();
  const gateConfigured = isAdminAccessConfigured();
  const authorized = !gateConfigured || (requiredKey && providedKey?.trim() === requiredKey);

  return (
    <div dir="rtl" className="min-h-screen bg-[#f8fafc] text-slate-900">
      <div className="lg:flex">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-[1480px] p-4 sm:p-6 lg:p-10">
            {authorized ? (
              <NewsSourcesConsole adminKey={gateConfigured ? providedKey?.trim() ?? "" : ""} />
            ) : (
              <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                دسترسی به این صفحه محدود شده است. با پارامتر <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">?key=</code> وارد شوید.
              </p>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
