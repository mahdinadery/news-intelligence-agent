import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
// A temporary sibling preserves package resolution while making TS imports explicit for Node.
const moduleUrl = new URL(`../src/lib/news/.telegram-test-${randomUUID()}.ts`,import.meta.url);
const source = await readFile(new URL('../src/lib/news/telegram.ts',import.meta.url),'utf8');
await writeFile(moduleUrl,source.replace('from "./telegram-channel"','from "./telegram-channel.ts"'));
let telegram;
try { telegram = await import(moduleUrl.href); } finally { await unlink(moduleUrl); }
const { parseTelegramPage, fetchTelegramChannel } = telegram;
const html = await readFile(new URL('./fixtures/telegram-public.html',import.meta.url),'utf8');
test('public posts normalize text, captions, dates, canonical links and stable IDs', () => {
  const result = parseTelegramPage(html,'@creditnews');
  assert.equal(result.ok,true);
  assert.equal(result.items.length,2);
  assert.equal(result.items[0].externalId,'telegram:creditnews:101');
  assert.equal(result.items[1].url,'https://t.me/creditnews/100');
  assert.equal(result.items[1].publishedAt.toISOString(),'2026-11-01T10:00:00.000Z');
  assert.equal(result.items[1].title,'عنوان خبر اول');
  assert.ok(result.items[1].content.includes('جزئیات & توضیح اعتبارسنجی'));
  assert.ok(!result.items[1].content.includes('do_not_import'));
  assert.equal(result.skipped,3);
});
test('empty or unavailable public previews fail explicitly without invented items', () => {
  for (const body of ['<html>login required</html>','<div></div>']) assert.equal(parseTelegramPage(body,'creditnews').ok,false);
});
test('fetch always uses a fixed HTTPS host with redirects blocked', async () => {
  let calls=0;
  const result = await fetchTelegramChannel('@CreditNews',async (url,options)=>{
    calls++;
    assert.equal(url,'https://t.me/s/creditnews');
    assert.equal(options.redirect,'error');
    return new Response(html);
  });
  assert.equal(result.ok,true);
  assert.equal(calls,1);
});
test('invalid target never makes a request; HTTP/network/size errors are handled', async () => {
  const invalid = await fetchTelegramChannel('https://127.0.0.1/private',async()=>{throw new Error('should never fetch');});
  assert.equal(invalid.code,'invalid_url');
  assert.equal((await fetchTelegramChannel('creditnews',async()=>new Response('',{status:403}))).code,'http_error');
  assert.equal((await fetchTelegramChannel('creditnews',async()=>{throw new Error('network');})).code,'network_error');
  assert.equal((await fetchTelegramChannel('creditnews',async()=>new Response('a'.repeat(1500001)))).code,'invalid_feed');
});
