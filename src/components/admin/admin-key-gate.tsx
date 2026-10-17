"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type LoginResponse = { success?: boolean; message?: string; required?: boolean };

/**
 * Popup that asks for ADMIN_ACCESS_KEY and unlocks the admin area for this
 * browser via an HttpOnly session cookie (see /api/admin/auth).
 */
export function AdminKeyGate() {
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Slight delay so the card's entrance animation is not interrupted.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = key.trim();
    if (!trimmed || pending) return;

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmed }),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as LoginResponse | null;

      if (!response.ok || !payload?.success) {
        setError(payload?.message ?? "ورود ناموفق بود. کلید مدیریتی را بررسی کنید.");
        setPending(false);
        inputRef.current?.select();
        return;
      }

      // Cookie is set. Remove any (possibly wrong) key from the URL and let the
      // server re-render the protected page using the cookie.
      const url = new URL(window.location.href);
      url.searchParams.delete("key");
      url.searchParams.delete("adminKey");
      window.location.replace(url.toString());
    } catch {
      setError("ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی و دوباره تلاش کنید.");
      setPending(false);
    }
  }

  const inputId = "admin-access-key";
  const titleId = "admin-access-key-title";
  const descriptionId = "admin-access-key-description";

  return (
    <div className="relative isolate flex min-h-[calc(100vh-4.5rem)] items-center justify-center overflow-hidden rounded-3xl border border-slate-200/80 bg-white px-3 py-8 shadow-sm sm:px-8 lg:min-h-[calc(100vh-5rem)]">
      {/* Blurred mock of the locked admin console, so the popup reads as a
          layer on top of the real page rather than a separate route. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none opacity-80 blur-[3px]">
        <div className="mx-auto max-w-5xl space-y-4 p-5 sm:p-9">
          <div className="h-3 w-28 rounded-full bg-blue-200" />
          <div className="h-8 w-64 max-w-full rounded-lg bg-slate-200" />
          <div className="h-4 w-96 max-w-full rounded bg-slate-100" />
          <div className="grid gap-3 pt-2 sm:grid-cols-4">
            {[0, 1, 2, 3].map((index) => (
              <div className="h-20 rounded-2xl border border-slate-200 bg-white" key={index}>
                <div className="m-4 h-2.5 w-16 rounded bg-slate-100" />
                <div className="mx-4 h-5 w-10 rounded bg-slate-200" />
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="h-3 w-40 rounded bg-slate-100" />
            <div className="mt-4 space-y-3">
              {[88, 74, 92, 66, 80].map((width) => (
                <div className="flex items-center gap-3" key={width}>
                  <div className="h-2.5 rounded bg-slate-100" style={{ width: `${width}%` }} />
                  <div className="h-6 w-16 shrink-0 rounded-full bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-white/55 via-white/70 to-white/90" />

      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-[0_30px_90px_-30px_rgba(15,23,42,0.55)] ring-1 ring-white/70 backdrop-blur"
        role="dialog"
      >
        <div className="h-1.5 w-full bg-gradient-to-l from-blue-600 via-sky-500 to-cyan-400" />
        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
              <svg aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path d="M7 10V7a5 5 0 0 1 10 0v3" strokeLinecap="round" strokeLinejoin="round" />
                <rect height="10" rx="2.5" strokeLinecap="round" width="16" x="4" y="10" />
                <path d="M12 14.5v2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <p className="text-[11px] font-bold tracking-wide text-blue-600">ناحیه مدیریت</p>
              <h1 className="text-lg font-bold text-slate-950" id={titleId}>
                ورود با کلید مدیریتی
              </h1>
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-500" id={descriptionId}>
            این صفحه با کلید مدیریتی محافظت می‌شود. برای ادامه، کلید{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600" dir="ltr">
              ADMIN_ACCESS_KEY
            </code>{" "}
            را وارد کنید.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-600" htmlFor={inputId}>
                کلید مدیریتی
              </label>
              <div className="relative">
                <input
                  aria-invalid={error ? true : undefined}
                  autoCapitalize="none"
                  autoComplete="current-password"
                  autoCorrect="off"
                  className={`w-full rounded-xl border bg-white py-3 pl-3 pr-16 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-300 focus:ring-4 ${
                    error
                      ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                      : "border-slate-200 focus:border-blue-400 focus:ring-blue-100"
                  }`}
                  dir="ltr"
                  disabled={pending}
                  id={inputId}
                  name="admin-key"
                  onChange={(event) => {
                    setKey(event.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="••••••••••••"
                  ref={inputRef}
                  spellCheck={false}
                  type={showKey ? "text" : "password"}
                  value={key}
                />
                <button
                  aria-label={showKey ? "پنهان‌کردن کلید" : "نمایش کلید"}
                  aria-pressed={showKey}
                  className="absolute inset-y-1.5 right-1.5 rounded-lg px-2.5 text-[11px] font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-50"
                  disabled={pending}
                  onClick={() => setShowKey((value) => !value)}
                  type="button"
                >
                  {showKey ? "پنهان" : "نمایش"}
                </button>
              </div>
            </div>

            {error ? (
              <p
                className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs leading-5 text-rose-700"
                role="alert"
              >
                <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7.5v5M12 16.5h.01" strokeLinecap="round" />
                </svg>
                <span>{error}</span>
              </p>
            ) : null}

            <button
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              disabled={pending || !key.trim()}
              type="submit"
            >
              {pending ? (
                <>
                  <svg aria-hidden="true" className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-90" d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
                  </svg>
                  در حال بررسی…
                </>
              ) : (
                "باز کردن پنل مدیریت"
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-[11px] leading-5 text-slate-400">
            پس از ورود، این مرورگر تا ۱۲ ساعت باز می‌ماند. کلید در آدرس صفحه ذخیره یا نمایش داده نمی‌شود.
          </p>
        </div>
      </section>
    </div>
  );
}
