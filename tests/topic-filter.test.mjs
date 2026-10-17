import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateTopicFilter,
  isTopicFilterActive,
  normalizeForMatch,
} from "../src/lib/news/topic-filter.ts";

const filter = (overrides) => ({
  enabled: true,
  mode: "include",
  topics: [],
  ...overrides,
});

const topic = (overrides) => ({
  id: "t1",
  label: "بازار خودرو",
  enabled: true,
  keywords: ["خودرو", "قیمت خودرو"],
  ...overrides,
});

test("normalizeForMatch folds Persian/Arabic variants and ZWNJ", () => {
  // ZWNJ is stripped, so «می‌شود» and «میشود» compare equal; Arabic ي/ك fold to Persian.
  assert.equal(normalizeForMatch("كي‌مي‌شود"), normalizeForMatch("کیمیشود"));
  assert.equal(normalizeForMatch("می‌شود"), normalizeForMatch("میشود"));
  assert.equal(normalizeForMatch("بانك"), normalizeForMatch("بانک"));
  assert.equal(normalizeForMatch("  خودرو  "), "خودرو");
  assert.equal(normalizeForMatch(null), "");
});

test("disabled filter passes everything (fail-open)", () => {
  const outcome = evaluateTopicFilter({ title: "هر خبری" }, filter({ enabled: false }));
  assert.equal(outcome.verdict, "pass");
  assert.equal(outcome.reason, "filter_disabled");
});

test("missing/null filter passes everything (fail-open)", () => {
  assert.equal(evaluateTopicFilter({ title: "x" }, null).verdict, "pass");
  assert.equal(evaluateTopicFilter({ title: "x" }, undefined).verdict, "pass");
});

test("filter with no effective keywords passes everything (fail-open)", () => {
  const outcome = evaluateTopicFilter(
    { title: "خبر نامرتبط" },
    filter({ topics: [topic({ keywords: [] }), topic({ id: "t2", enabled: false, keywords: ["الف"] })] }),
  );
  assert.equal(outcome.verdict, "pass");
  assert.equal(outcome.reason, "no_effective_topics");
});

test("include mode: matching topic passes, non-matching is skipped", () => {
  const f = filter({ topics: [topic()] });

  const hit = evaluateTopicFilter({ title: "قیمت خودرو در بازار امروز" }, f);
  assert.equal(hit.verdict, "pass");
  assert.equal(hit.reason, "matched_topic");
  assert.deepEqual(hit.matchedTopics, ["بازار خودرو"]);

  const miss = evaluateTopicFilter({ title: "نتایج لیگ فوتبال" }, f);
  assert.equal(miss.verdict, "skip");
  assert.equal(miss.reason, "not_in_selected_topics");
});

test("include mode matches across title/description/content and ORs topics", () => {
  const f = filter({
    topics: [topic(), topic({ id: "t2", label: "مسکن", keywords: ["مسکن"] })],
  });

  const viaDescription = evaluateTopicFilter({ title: "تحلیل بازار", description: "روند معاملات مسکن" }, f);
  assert.equal(viaDescription.verdict, "pass");
  assert.deepEqual(viaDescription.matchedTopics, ["مسکن"]);

  const viaContent = evaluateTopicFilter({ title: "گزارش روز", content: "واردات خودرو کاهش یافت" }, f);
  assert.equal(viaContent.verdict, "pass");
  assert.deepEqual(viaContent.matchedTopics, ["بازار خودرو"]);
});

test("multi-word keywords match as phrases", () => {
  const f = filter({ topics: [topic({ keywords: ["قیمت خودرو"] })] });
  assert.equal(evaluateTopicFilter({ title: "قیمت خودرو امروز" }, f).verdict, "pass");
  assert.equal(evaluateTopicFilter({ title: "قیمت مسکن و خودرو" }, f).verdict, "skip");
});

test("Persian keywords match regardless of ZWNJ/Arabic letter variants", () => {
  const f = filter({ topics: [topic({ keywords: ["سیاست پولی"] })] });
  assert.equal(evaluateTopicFilter({ title: "سياست پولي بانک مرکزی" }, f).verdict, "pass");
});

test("exclude mode: matching topic is skipped, others pass", () => {
  const f = filter({ mode: "exclude", topics: [topic({ label: "فوتبال", keywords: ["فوتبال"] })] });

  const noise = evaluateTopicFilter({ title: "نتایج فوتبال" }, f);
  assert.equal(noise.verdict, "skip");
  assert.equal(noise.reason, "matched_excluded_topic");

  const keep = evaluateTopicFilter({ title: "قیمت خودرو" }, f);
  assert.equal(keep.verdict, "pass");
});

test("disabled topic rows are ignored", () => {
  const f = filter({ topics: [topic({ enabled: false })] });
  const outcome = evaluateTopicFilter({ title: "خودرو" }, f);
  assert.equal(outcome.verdict, "pass");
  assert.equal(outcome.reason, "no_effective_topics");
});

test("blocked keywords win in include mode even when a topic matches", () => {
  const f = filter({ topics: [topic()], blockedKeywords: ["ورزش", "فوتبال"] });
  const outcome = evaluateTopicFilter({ title: "قیمت خودرو و حاشیه‌های فوتبال" }, f);
  assert.equal(outcome.verdict, "skip");
  assert.equal(outcome.reason, "matched_blocked_keyword");
  assert.deepEqual(outcome.blockedKeywords, ["فوتبال"]);
  assert.deepEqual(outcome.matchedTopics, []);
});

test("blocked keywords win in exclude mode too", () => {
  const f = filter({ mode: "exclude", topics: [topic()], blockedKeywords: ["حوادث"] });
  const outcome = evaluateTopicFilter({ title: "گزارش حوادث جاده‌ای" }, f);
  assert.equal(outcome.verdict, "skip");
  assert.equal(outcome.reason, "matched_blocked_keyword");
});

test("deny-list-only configuration filters blocked news and passes the rest", () => {
  const f = filter({ topics: [], blockedKeywords: ["ورزش", "سرگرمی"] });

  const blocked = evaluateTopicFilter({ title: "نتایج مسابقات ورزشی" }, f);
  assert.equal(blocked.verdict, "skip");
  assert.equal(blocked.reason, "matched_blocked_keyword");

  const allowed = evaluateTopicFilter({ title: "انتشار صورت‌های مالی بانک" }, f);
  assert.equal(allowed.verdict, "pass");
  assert.equal(allowed.reason, "no_excluded_match");
});

test("blocked keyword matching is Persian-normalized", () => {
  const f = filter({ topics: [topic()], blockedKeywords: ["سینما"] });
  const outcome = evaluateTopicFilter({ title: "بازگشت هنرمندان به سينما" }, f);
  assert.equal(outcome.verdict, "skip");
  assert.equal(outcome.reason, "matched_blocked_keyword");
});

test("isTopicFilterActive recognises a deny-list-only configuration", () => {
  assert.equal(isTopicFilterActive(filter({ topics: [], blockedKeywords: ["ورزش"] })), true);
  assert.equal(isTopicFilterActive(filter({ topics: [], blockedKeywords: ["  "] })), false);
});

test("isTopicFilterActive reflects real narrowing only", () => {
  assert.equal(isTopicFilterActive(null), false);
  assert.equal(isTopicFilterActive(filter({ enabled: false })), false);
  assert.equal(isTopicFilterActive(filter({ topics: [topic({ keywords: [] })] })), false);
  assert.equal(isTopicFilterActive(filter({ topics: [topic()] })), true);
});

