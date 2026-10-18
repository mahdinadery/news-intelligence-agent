import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BULLETIN_ITEMS,
  buildBulletinMessage,
  pickBulletinItems,
} from "../src/lib/delivery/bulletin.ts";

const item = (overrides) => ({
  id: "n1",
  title: "انتشار رتبه‌بندی اعتباری شرکت‌های بزرگ",
  oneLiner: "خلاصه کوتاه خبر.",
  whyItMatters: "به سبد اعتباری بانک‌ها مربوط است.",
  url: "https://example.com/news/1",
  importanceScore: 80,
  publishedAt: new Date("2026-10-18T08:00:00Z"),
  ...overrides,
});

test("buildBulletinMessage: header, intro, and per-item minimal columns", () => {
  const text = buildBulletinMessage({
    intro: "امروز محور اصلی، تحولات رتبه‌بندی اعتباری بود.",
    items: [item({}), item({ id: "n2", title: "خبر دوم", url: "https://example.com/news/2" })],
    generatedAt: new Date("2026-10-18T12:00:00Z"),
    timezone: "Asia/Tehran",
  });

  assert.ok(text.startsWith("🗞️ بولتن خبری"));
  const introAt = text.indexOf("امروز محور اصلی");
  const firstTitleAt = text.indexOf("1️⃣ انتشار رتبه‌بندی");
  const secondTitleAt = text.indexOf("2️⃣ خبر دوم");
  assert.ok(introAt > 0);
  assert.ok(firstTitleAt > introAt);
  assert.ok(secondTitleAt > firstTitleAt);
  assert.ok(text.includes("خلاصه کوتاه خبر."));
  assert.ok(text.includes("چرا مهم است: به سبد اعتباری بانک‌ها مربوط است."));
  assert.ok(text.includes("🔗 https://example.com/news/1"));
});

test("buildBulletinMessage: no intro block when AI brief is missing", () => {
  const text = buildBulletinMessage({
    intro: null,
    items: [item({})],
    generatedAt: new Date("2026-10-18T12:00:00Z"),
    timezone: "Asia/Tehran",
  });
  const lines = text.split("\n");
  assert.equal(lines[0].startsWith("🗞️ بولتن خبری"), true);
  // Second line is a blank separator straight before the first item.
  assert.ok(text.includes("1️⃣ "));
});

test("buildBulletinMessage: long fields are compacted", () => {
  const text = buildBulletinMessage({
    intro: "متن ".repeat(300),
    items: [item({ title: "عنوان ".repeat(60), oneLiner: "خط ".repeat(80) })],
    generatedAt: new Date("2026-10-18T12:00:00Z"),
    timezone: "Asia/Tehran",
  });
  for (const line of text.split("\n")) {
    assert.ok(line.length < 700, `line too long: ${line.slice(0, 40)}…`);
  }
});

test("buildBulletinMessage: invalid timezone falls back to ISO date", () => {
  const text = buildBulletinMessage({
    intro: null,
    items: [],
    generatedAt: new Date("2026-10-18T12:00:00Z"),
    timezone: "Not/AZone",
  });
  assert.ok(text.includes("2026-10-18"));
});

test("pickBulletinItems: ranks by importance then recency, caps at max", () => {
  const older = new Date("2026-10-17T08:00:00Z");
  const newer = new Date("2026-10-18T08:00:00Z");
  const picked = pickBulletinItems(
    [
      item({ id: "low", importanceScore: 40, publishedAt: newer }),
      item({ id: "high-old", importanceScore: 90, publishedAt: older }),
      item({ id: "high-new", importanceScore: 90, publishedAt: newer }),
      item({ id: "mid", importanceScore: 60, publishedAt: newer }),
    ],
    3,
  );
  assert.deepEqual(
    picked.map((entry) => entry.id),
    ["high-new", "high-old", "mid"],
  );
});

test("pickBulletinItems: never exceeds MAX_BULLETIN_ITEMS", () => {
  const many = Array.from({ length: 10 }, (_, index) =>
    item({ id: `n${index}`, importanceScore: 100 - index }),
  );
  assert.equal(pickBulletinItems(many).length, MAX_BULLETIN_ITEMS);
  assert.equal(pickBulletinItems(many, 2).length, 2);
});
