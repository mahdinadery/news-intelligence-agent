import assert from "node:assert/strict";
import test from "node:test";

import { buildNewsMessage } from "../src/lib/delivery/message.ts";

const row = (overrides) => ({
  title: "انتشار رتبه‌بندی اعتباری شرکت‌های بزرگ",
  summary: "خلاصه آزمایشی برای پیام.",
  whyItMatters: null,
  category: "اقتصاد",
  importanceScore: 80,
  url: "https://example.com/news/1",
  ...overrides,
});

test("buildNewsMessage: 'why it matters' block appears after the summary when set", () => {
  const text = buildNewsMessage(row({ whyItMatters: "به سبد اعتباری بانک‌ها مربوط است." }));
  const summaryAt = text.indexOf("خلاصه:");
  const whyAt = text.indexOf("چرا مهم است:");
  assert.ok(summaryAt >= 0);
  assert.ok(whyAt > summaryAt);
  assert.ok(text.includes("به سبد اعتباری بانک‌ها مربوط است."));
  // The block must stay above the category section.
  assert.ok(whyAt < text.indexOf("دسته:"));
});

test("buildNewsMessage: no empty block when the field is missing or blank", () => {
  assert.ok(!buildNewsMessage(row({})).includes("چرا مهم است:"));
  assert.ok(!buildNewsMessage(row({ whyItMatters: "   " })).includes("چرا مهم است:"));
});

test("buildNewsMessage: long explanations are compacted, not dumped raw", () => {
  const text = buildNewsMessage(row({ whyItMatters: "مهم ".repeat(200) }));
  const line = text.split("\n").find((entry) => entry.startsWith("مهم"));
  assert.ok(line.length < 320);
});
