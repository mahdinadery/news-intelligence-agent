import assert from "node:assert/strict";
import test from "node:test";

import { slugForUrl } from "../src/lib/delivery/slug.ts";
import { buildNewsMessage } from "../src/lib/delivery/message.ts";
import { buildBulletinMessage } from "../src/lib/delivery/bulletin.ts";

const row = (overrides = {}) => ({
  title: "انتشار رتبه‌بندی اعتباری شرکت‌های بزرگ",
  summary: "خلاصه آزمایشی برای پیام.",
  whyItMatters: null,
  category: "اقتصاد",
  importanceScore: 80,
  source: "ایسنا",
  url: "https://example.com/news/very/long/path?utm_source=x&id=1",
  ...overrides,
});

// ── slugForUrl ──────────────────────────────────────────────────────────────

test("slugForUrl is deterministic and 8-char base62", () => {
  const url = "https://www.eghtesadonline.com/fa/news/2168992/x";
  const a = slugForUrl(url);
  const b = slugForUrl(url);
  assert.equal(a, b);
  assert.match(a, /^[0-9A-Za-z]{8}$/);
});

test("different URLs get different slugs; salt changes the fallback slug", () => {
  const one = slugForUrl("https://example.com/a");
  const two = slugForUrl("https://example.com/b");
  assert.notEqual(one, two);
  assert.notEqual(slugForUrl("https://example.com/a", "r1"), one);
});

// ── buildNewsMessage with linkFor ───────────────────────────────────────────

test("single-source message shows the short link instead of the long URL", () => {
  const linkFor = (url) => `https://nia.example/s/${slugForUrl(url)}`;
  const text = buildNewsMessage(row(), { linkFor });
  assert.ok(!text.includes(row().url), "long URL must not appear");
  assert.ok(text.includes(`🔗 منبع:\nhttps://nia.example/s/${slugForUrl(row().url)}`));
});

test("multi-source block shortens every outlet link", () => {
  const linkFor = (url) => `https://nia.example/s/${slugForUrl(url)}`;
  const otherUrl = "https://other.example/x";
  const text = buildNewsMessage(row(), {
    linkFor,
    corroborationItems: [{ source: "مهر", url: otherUrl }],
  });
  assert.ok(text.includes(`(انتخاب‌شده): https://nia.example/s/${slugForUrl(row().url)}`));
  assert.ok(text.includes(`مهر: https://nia.example/s/${slugForUrl(otherUrl)}`));
  assert.ok(!text.includes(otherUrl));
});

test("without linkFor the original URLs stay untouched", () => {
  const text = buildNewsMessage(row());
  assert.ok(text.includes(row().url));
});

// ── buildBulletinMessage with linkFor ───────────────────────────────────────

test("bulletin items render the short link on the 🔗 line", () => {
  const linkFor = (url) => `https://nia.example/s/${slugForUrl(url)}`;
  const item = {
    id: "1",
    title: "خبر آزمایشی مهم",
    oneLiner: "توضیح کوتاه.",
    whyItMatters: "اثر مستقیم بر نقدینگی بانک‌ها.",
    url: "https://example.com/long/long/long",
    importanceScore: 85,
    publishedAt: new Date("2026-10-18T10:00:00.000Z"),
  };
  const text = buildBulletinMessage({
    intro: null,
    items: [item],
    generatedAt: new Date("2026-10-19T10:00:00.000Z"),
    timezone: "Asia/Tehran",
    linkFor,
  });
  assert.ok(text.includes(`🔗 https://nia.example/s/${slugForUrl(item.url)}`));
  assert.ok(!text.includes(item.url));
});

test("bulletin without linkFor keeps original URLs", () => {
  const item = {
    id: "1",
    title: "خبر آزمایشی",
    oneLiner: null,
    whyItMatters: null,
    url: "https://example.com/x",
    importanceScore: 70,
    publishedAt: null,
  };
  const text = buildBulletinMessage({
    intro: null,
    items: [item],
    generatedAt: new Date("2026-10-19T10:00:00.000Z"),
    timezone: "Asia/Tehran",
  });
  assert.ok(text.includes("🔗 https://example.com/x"));
});
