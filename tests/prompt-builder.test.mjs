import assert from "node:assert/strict";
import test from "node:test";

import { buildAIAnalysisPrompt } from "../src/lib/ai/prompt-builder.ts";

const features = {
  summary: { enabled: true, instruction: "خلاصه بنویس." },
  shouldSend: { enabled: true, instruction: "توصیه ارسال بده." },
};

const decisionRules = (overrides = {}) => ({
  minImportanceToSend: 70,
  minRelevanceToSend: 70,
  minNoveltyToSend: 0,
  overallSendThreshold: 70,
  enableAutoRecommendation: true,
  ...overrides,
});

const config = (overrides = {}) => ({
  systemPrompt: "تحلیلگر خبری.",
  features,
  decisionRules: decisionRules(),
  outputSchema: [
    { name: "summary", enabled: true, description: "خلاصه", required: true, type: "string" },
    { name: "shouldSend", enabled: true, description: "ارسال", required: true, type: "boolean" },
  ],
  topicFilter: null,
  ...overrides,
});

const article = {
  title: "خبر آزمایشی",
  description: "متن",
  source: "تست",
  publishedAt: null,
};

test("decision rules default to AND (importance AND relevance)", () => {
  const { systemPrompt } = buildAIAnalysisPrompt(config(), article);
  assert.match(systemPrompt, /هم‌زمان برقرار باشند \(منطق AND\)/);
  assert.match(systemPrompt, /اهمیت بالا هرگز جای مرتبط بودن پایین/);
  assert.doesNotMatch(systemPrompt, /حداقل یکی از این شرایط/);
});

test("legacy OR mode is explicit when configured", () => {
  const { systemPrompt } = buildAIAnalysisPrompt(
    config({ decisionRules: decisionRules({ combine: "any" }) }),
    article,
  );
  assert.match(systemPrompt, /منطق OR/);
  assert.doesNotMatch(systemPrompt, /\(منطق AND\)/);
});

test("novelty is only mentioned when a threshold above zero is set", () => {
  const withoutNovelty = buildAIAnalysisPrompt(config(), article).systemPrompt;
  assert.doesNotMatch(withoutNovelty, /تازگی \(novelty\) >=/);

  const withNovelty = buildAIAnalysisPrompt(
    config({ decisionRules: decisionRules({ minNoveltyToSend: 40 }) }),
    article,
  ).systemPrompt;
  assert.match(withNovelty, /تازگی \(novelty\) >= 40/);
});

test("disabled auto recommendation forces shouldSend=false", () => {
  const { systemPrompt } = buildAIAnalysisPrompt(
    config({ decisionRules: decisionRules({ enableAutoRecommendation: false }) }),
    article,
  );
  assert.match(systemPrompt, /همیشه false/);
});

test("the topic focus and deny-list are injected into the prompt", () => {
  const { systemPrompt } = buildAIAnalysisPrompt(
    config({
      topicFilter: {
        enabled: true,
        mode: "include",
        topics: [{ id: "t1", label: "اعتبارسنجی", enabled: true, keywords: ["رتبه‌بندی اعتباری"] }],
        blockedKeywords: ["ورزش", "سرگرمی"],
      },
    }),
    article,
  );
  assert.match(systemPrompt, /اعتبارسنجی/);
  assert.match(systemPrompt, /کلیدواژه‌های ممنوع/);
  assert.match(systemPrompt, /ورزش/);
});

test("the user prompt carries the article content", () => {
  const { userPrompt } = buildAIAnalysisPrompt(config(), article);
  assert.match(userPrompt, /خبر آزمایشی/);
  assert.match(userPrompt, /منبع: تست/);
});

test("only enabled features appear in the output contract", () => {
  const { systemPrompt, enabledFields } = buildAIAnalysisPrompt(config(), article);
  assert.deepEqual(enabledFields, ["summary", "shouldSend"]);
  assert.match(systemPrompt, /"summary"/);
  assert.match(systemPrompt, /"shouldSend"/);
  assert.doesNotMatch(systemPrompt, /"importance"/);
});
