/**
 * Admin access gate — SERVER-SIDE ONLY.
 *
 * IMPORTANT / KNOWN LIMITATION: this codebase has no authentication/session
 * system yet (no login, no users table, no cookies). Building a full auth
 * system is out of scope for this milestone ("do not rebuild the existing
 * architecture"). As the smallest safe stand-in, admin routes/pages are gated
 * by an optional `ADMIN_ACCESS_KEY` environment variable, following the same
 * pattern already used for other operational toggles in this project
 * (AUTO_SEND_*, BALE_DELIVERY_MODE, etc.):
 *
 *   - If ADMIN_ACCESS_KEY is NOT set, the admin area stays open (so this
 *     milestone is usable out of the box in this sandbox) but a visible banner
 *     on the page states this clearly.
 *   - If ADMIN_ACCESS_KEY IS set, requests must present it via the
 *     `x-admin-key` header or a `key` query parameter, otherwise they are
 *     rejected with 401.
 *
 * When real authentication is added to the project, replace this module's
 * checks with the real session/role check — every call site already goes
 * through this single function.
 */

export type AdminAccessCheck = { authorized: true } | { authorized: false; reason: string };

export function isAdminAccessConfigured(): boolean {
  return Boolean(process.env.ADMIN_ACCESS_KEY?.trim());
}

export function checkAdminAccess(request: Request): AdminAccessCheck {
  const requiredKey = process.env.ADMIN_ACCESS_KEY?.trim();

  if (!requiredKey) {
    // No key configured: open access (documented limitation, see module docstring).
    return { authorized: true };
  }

  const headerKey = request.headers.get("x-admin-key")?.trim();
  const url = new URL(request.url);
  const queryKey = url.searchParams.get("key")?.trim();

  if (headerKey === requiredKey || queryKey === requiredKey) {
    return { authorized: true };
  }

  return { authorized: false, reason: "دسترسی غیرمجاز: کلید مدیریتی نامعتبر یا وارد نشده است." };
}
