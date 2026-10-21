import assert from "node:assert/strict";
import test from "node:test";

import { buildNewsMessage, escapeMd, mdLink } from "../src/lib/delivery/message.ts";
import { buildBulletinMessage } from "../src/lib/delivery/bulletin.ts";

const URL = "https://www.eghtesadonline.com/fa/news/2168992/رکود-اقتصاد";

const row = (overrides = {}) => ({
  title: "رکود اقتصاد ایران ۱۸ ماهه شد",
  summary: "خلاصه آزمایشی برای پیام.",
  whyItMatters: "اثر مستقیم بر ترازنامه بانک‌ها دارد.",
  category: "اقتصاد",
  importanceScore: 80,
  source: "ایسنا",
  url: URL,
  ...overrides,
});

test("mdLink builds a markdown hyperlink and escapes markup in the label", () => {
  assert.equal(mdLink("عنوان ساده", "https://x.example/a"), "[عنوان ساده](https://x.example/a)");
  assert.equal(mdLink("الف [و] _ب_", "https://x.example/a"), "[الف \\[و\\] \\_ب\\_](https://x.example/a)");
  // Parens and spaces inside the URL are percent-encoded so the link parses.
  assert.equal(mdLink("متن", "https://x.example/a b(c)"), "[متن](https://x.example/a%20b%28c%29)");
});

test("escapeMd escapes every markdown control character", () => {
  assert.equal(escapeMd("a_b*c[d]e`f\\g"), "a\\_b\\*c\\[d\\]e\\`f\\\\g");
});

test("the news title is a hyperlink to the ORIGINAL source URL (built-in layout)", () => {
  const text = buildNewsMessage(row());
  assert.ok(text.includes(`[رکود اقتصاد ایران ۱۸ ماهه شد](${URL})`), "title must be the hyperlink");
  // The source line keeps the plain ORIGINAL url — no short links.
  assert.ok(text.includes(`🔗 منبع:\n${URL}`));
  assert.ok(!text.includes("/s/"), "short links are gone");
});

test("multi-source footer keeps plain original URLs", () => {
  const other = "https://other.example/x";
  const text = buildNewsMessage(row(), { corroborationItems: [{ source: "مهر", url: other }] });
  assert.ok(text.includes(`(انتخاب‌شده): ${URL}`));
  assert.ok(text.includes(`مهر: ${other}`));
});

test("a title with markdown characters stays a valid single link", () => {
  const text = buildNewsMessage(row({ title: "گزارش [ماهانه] _شاخص_ بانک‌ها" }));
  assert.ok(text.includes("[گزارش \\[ماهانه\\] \\_شاخص\\_ بانک‌ها](" + URL + ")"));
});

test("bulletin item titles are hyperlinks to the original URL", () => {
  const text = buildBulletinMessage({
    intro: null,
    items: [
      {
        id: "1",
        title: "خبر آزمایشی مهم",
        oneLiner: "توضیح کوتاه.",
        whyItMatters: "اثر مستقیم بر نقدینگی بانک‌ها.",
        url: URL,
        importanceScore: 85,
        publishedAt: new Date("2026-10-18T10:00:00.000Z"),
      },
    ],
    generatedAt: new Date("2026-10-19T10:00:00.000Z"),
    timezone: "Asia/Tehran",
  });
  assert.ok(text.includes(`1️⃣ [خبر آزمایشی مهم](${URL})`));
  assert.ok(text.includes(`🔗 ${URL}`));
  assert.ok(!text.includes("/s/"));
});
