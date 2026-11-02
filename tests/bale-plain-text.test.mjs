import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToPlainText } from '../src/lib/bale/plain-text.ts';
test('plain fallback removes raw Markdown link syntax but preserves the source URL and newlines', () => {
  const text = 'بولتن\n\n[لینک اصلی خبر](https://example.com/%D8%A8?q=1)\n#بازار\\_سهام';
  assert.equal(markdownToPlainText(text), 'بولتن\n\nلینک اصلی خبر: https://example.com/%D8%A8?q=1\n#بازار_سهام');
});
test('ordinary text and encoded URL parentheses survive fallback conversion', () => {
  assert.equal(markdownToPlainText('متن ساده\nخط دوم'), 'متن ساده\nخط دوم');
  assert.equal(markdownToPlainText('[خبر](https://example.com/a%28b%29)'), 'خبر: https://example.com/a%28b%29');
});
