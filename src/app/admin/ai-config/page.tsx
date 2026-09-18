import { isAdminAccessConfigured } from "@/lib/admin/access";
import { AiConfigConsole } from "@/components/admin/ai-config-console";
import { Sidebar } from "@/components/sidebar";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "مرکز پیکربندی هوش مصنوعی | دستیار هوشمند اخبار",
  description: "پیکربندی رفتار تحلیل هوش مصنوعی بدون نیاز به تغییر کد",
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AiConfigPage({ searchParams }: PageProps) {
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
          <div className="mx-auto max-w-[1280px] p-4 sm:p-6 lg:p-10">
            {!gateConfigured ? (
              <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
                <p className="font-bold">هشدار امنیتی: احراز هویت واقعی هنوز متصل نشده است.</p>
                <p className="mt-1 leading-6">
                  این پروژه هنوز سامانه ورود/نشست کاربری ندارد. این صفحه با متغیر محیطی{" "}
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">ADMIN_ACCESS_KEY</code> قفل
                  می‌شود؛ چون این متغیر تنظیم نشده، دسترسی برای همه باز است. برای محدودسازی، مقدار آن را در محیط
                  سرور تنظیم کنید و سپس با{" "}
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">?key=مقدار</code> وارد شوید.
                </p>
              </div>
            ) : null}

            {authorized ? (
              <AiConfigConsole adminKey={gateConfigured ? providedKey?.trim() ?? "" : ""} />
            ) : (
              <AccessDeniedGate />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function AccessDeniedGate() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <div className="grid h-14 w-14 place-items-center rounded-full bg-rose-50 text-rose-500 ring-1 ring-rose-100">
        <svg aria-hidden="true" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2Zm10-10V7a4 4 0 1 0-8 0v2" />
        </svg>
      </div>
      <h1 className="mt-5 text-lg font-bold text-slate-950">دسترسی به این صفحه محدود شده است</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
        این بخش مدیریتی برای مدیران محدود شده است. برای ورود، کلید مدیریتی را در انتهای آدرس صفحه به‌صورت{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">?key=کلید-شما</code> وارد کنید.
      </p>
    </div>
  );
}
