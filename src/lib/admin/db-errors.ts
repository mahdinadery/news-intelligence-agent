/**
 * DB/API error surfacing for admin routes — SERVER-SIDE ONLY.
 *
 * The admin consoles previously showed a generic Persian message for every
 * failure, which hid the real root cause (missing table after a schema drift,
 * wrong DATABASE_URL, unreachable Postgres, ...). This module classifies the
 * error into a SHORT, secret-free detail + an actionable hint so the dashboard
 * can tell the operator exactly what to fix.
 *
 * Never includes connection strings, credentials or SQL text with values — only
 * the driver's error message/code, truncated.
 */

export type DbErrorDiagnosis = {
  /** Short, sanitized technical detail (safe to show in the admin UI). */
  detail: string;
  /** Actionable Persian hint for the operator. */
  hint: string;
  /** 503 when the database itself is unreachable; 500 for query/schema errors. */
  status: 500 | 503;
};

function rawMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Belt-and-braces: never leak a connection string that might sit in the message.
  return message.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]").slice(0, 300);
}

export function diagnoseDbError(error: unknown): DbErrorDiagnosis {
  const message = rawMessage(error);
  const code = (error as { code?: string } | null)?.code ?? "";
  const lower = message.toLowerCase();

  if (
    !process.env.DATABASE_URL?.trim() ||
    lower.includes("database_url is required")
  ) {
    return {
      detail: message,
      hint: "متغیر محیطی DATABASE_URL تنظیم نشده است؛ آن را مطابق .env.example روی سرور تنظیم کنید.",
      status: 503,
    };
  }

  if (
    code.startsWith("ECONN") ||
    code === "08006" ||
    code === "08001" ||
    code === "08004" ||
    code === "57P03" ||
    lower.includes("econnrefused") ||
    lower.includes("connection terminated") ||
    lower.includes("timeout exceeded") ||
    lower.includes("connect_timeout") ||
    lower.includes("getaddrinfo") ||
    lower.includes("enotfound")
  ) {
    return {
      detail: message,
      hint: "اتصال به پایگاه داده برقرار نشد. DATABASE_URL و در دسترس بودن سرویس PostgreSQL را بررسی کنید.",
      status: 503,
    };
  }

  if (lower.includes("does not exist")) {
    // relation "x" does not exist / column "x" of relation "y" does not exist
    return {
      detail: message,
      hint: "ساختار دیتابیس با کد هماهنگ نیست (جدول یا ستون مورد انتظار وجود ندارد). دستور npm run db:ensure را روی دیتابیس اجرا کنید.",
      status: 500,
    };
  }

  return {
    detail: message,
    hint: "خطای غیرمنتظره پایگاه داده. جزئیات را بررسی کنید؛ در صورت نیاز npm run db:ensure را اجرا کنید.",
    status: 500,
  };
}
