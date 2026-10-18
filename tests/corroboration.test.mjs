import assert from "node:assert/strict";
import test from "node:test";

import {
  CORROBORATION_BONUS,
  CORROBORATION_MIN_SOURCES,
  corroborationBonus,
  similarityKeyOf,
} from "../src/lib/news/corroboration.ts";

test("similarityKeyOf: same event wording shares a key across outlets", () => {
  const a = similarityKeyOf("بانک مرکزی نرخ بهره بین بانکی را افزایش داد");
  const b = similarityKeyOf("افزایش نرخ بهره بین بانکی توسط بانک مرکزی");
  assert.ok(a.length > 0);
  assert.equal(a, b);
});

test("similarityKeyOf: punctuation, harakat and case do not change the key", () => {
  assert.equal(similarityKeyOf("سلامت مالی شرکت‌ها!"), similarityKeyOf("سلامتِ مالی شرکت ها"));
  assert.equal(similarityKeyOf("Bale Network"), similarityKeyOf("bale network"));
});

test("similarityKeyOf: thin titles produce no key", () => {
  assert.equal(similarityKeyOf("خبر"), "");
  assert.equal(similarityKeyOf(""), "");
  assert.equal(similarityKeyOf("از به در با"), "");
});

test("similarityKeyOf: unrelated titles get different keys", () => {
  const credit = similarityKeyOf("رتبه‌بندی اعتباری شرکت فولاد مبارکه اعلام شد");
  const sports = similarityKeyOf("نتایج هفته دهم مسابقات لیگ برتر اعلام شد");
  assert.notEqual(credit, sports);
});

test("corroborationBonus: only 2+ distinct sources earn the bonus", () => {
  assert.equal(corroborationBonus(0), 0);
  assert.equal(corroborationBonus(1), 0);
  assert.equal(corroborationBonus(2), CORROBORATION_BONUS);
  assert.equal(corroborationBonus(5), CORROBORATION_BONUS);
  assert.equal(CORROBORATION_MIN_SOURCES, 2);
});
