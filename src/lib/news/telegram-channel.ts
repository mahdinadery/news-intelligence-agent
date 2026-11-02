/** Accept only public channel usernames/links, never arbitrary fetch targets. */
export function normalizeTelegramChannel(input: string): string | null {
  let name = input.trim();
  if (name.startsWith("@")) name = name.slice(1);
  else if (/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\//i.test(name)) {
    try {
      const url = new URL(/^https?:\/\//i.test(name) ? name : `https://${name}`);
      if (!["t.me", "telegram.me"].includes(url.hostname.toLowerCase()) || url.port || url.username || url.password || url.search || url.hash) return null;
      const match = /^\/(?:s\/)?([a-zA-Z][a-zA-Z0-9_]{4,31})\/?$/.exec(url.pathname);
      if (!match) return null;
      name = match[1];
    } catch { return null; }
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(name)) return null;
  if (["share", "joinchat", "proxy", "socks", "login", "boost", "iv", "addstickers", "addemoji", "contact"].includes(name.toLowerCase())) return null;
  return name.toLowerCase();
}
