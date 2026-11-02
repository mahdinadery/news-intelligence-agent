import { load } from "cheerio";
import type { NewsFetchResult, NormalizedNews } from "./rss";
import { normalizeTelegramChannel } from "./telegram-channel";

/** Public web preview only. Media-only messages are intentionally not imported. */
export function parseTelegramPage(html: string, channel: string): NewsFetchResult {
  const username = normalizeTelegramChannel(channel);
  if (!username) return {ok:false,code:"invalid_url",message:"شناسهٔ کانال عمومی تلگرام معتبر نیست."};
  const $ = load(html);
  const source = ($(".tgme_channel_info_header_title").first().text().trim() || `@${username}`).slice(0,200);
  const seen = new Set<string>();
  const items: NormalizedNews[] = [];
  let skipped = 0;
  $(".tgme_widget_message[data-post]").each((_index, element) => {
    const node = $(element);
    const match = /^([a-zA-Z][a-zA-Z0-9_]{4,31})\/([1-9]\d*)$/.exec(node.attr("data-post") ?? "");
    if (!match || match[1].toLowerCase() !== username || seen.has(match[2])) { skipped++; return; }
    const textNode = node.find(".tgme_widget_message_text").first().clone();
    textNode.find("script,style,iframe").remove();
    textNode.find("br").replaceWith("\n");
    textNode.find("p,div").append("\n");
    const text = textNode.text().replace(/\u00a0/g," ").replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim().slice(0,20000);
    if (!text) { skipped++; return; }
    const timestamp = node.find(".tgme_widget_message_date time[datetime]").first().attr("datetime");
    const publishedAt = timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp) : null;
    seen.add(match[2]);
    items.push({title:(text.split("\n").find(line=>line.trim()) ?? text).slice(0,180),url:`https://t.me/${username}/${match[2]}`,source,publishedAt,
      description:text.slice(0,4000),content:text,imageUrl:null,externalId:`telegram:${username}:${match[2]}`,author:`@${username}`});
  });
  if (!items.length) return {ok:false,code:"no_items",message:"پست متنی قابل دریافت پیدا نشد؛ عمومی بودن کانال و در دسترس بودن پیش‌نمایش وب را بررسی کنید."};
  // Public previews render oldest first. Ingestion caps the newest items.
  items.sort((a,b) => Number(b.externalId?.split(":").at(-1)) - Number(a.externalId?.split(":").at(-1)));
  return {ok:true,source,items,skipped};
}

export async function fetchTelegramChannel(input: string, fetcher: typeof fetch = fetch): Promise<NewsFetchResult> {
  const username = normalizeTelegramChannel(input);
  if (!username) return {ok:false,code:"invalid_url",message:"شناسهٔ کانال عمومی تلگرام معتبر نیست."};
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),12000);
  try {
    const response = await fetcher(`https://t.me/s/${username}`, {signal:controller.signal,redirect:"error",headers:{"User-Agent":"Mozilla/5.0 NewsIntelligence/1.0","Accept":"text/html"}});
    if (!response.ok) return {ok:false,code:"http_error",message:`دریافت صفحهٔ عمومی تلگرام ناموفق بود (HTTP ${response.status}).`};
    if (!response.body) return {ok:false,code:"invalid_feed",message:"پاسخ تلگرام خالی بود."};
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1_500_000) { await reader.cancel(); return {ok:false,code:"invalid_feed",message:"حجم صفحهٔ تلگرام از سقف مجاز بیشتر است."}; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.length; }
    return parseTelegramPage(new TextDecoder().decode(bytes),username);
  } catch {
    return {ok:false,code:controller.signal.aborted ? "timeout" : "network_error",message:controller.signal.aborted ? "مهلت دریافت کانال تلگرام تمام شد." : "دسترسی به صفحهٔ عمومی تلگرام برقرار نشد؛ محدودیت شبکه، redirect یا دسترسی کانال را بررسی کنید."};
  } finally { clearTimeout(timeout); }
}
