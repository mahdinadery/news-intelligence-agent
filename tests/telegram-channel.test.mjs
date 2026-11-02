import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTelegramChannel } from '../src/lib/news/telegram-channel.ts';

test('accepts usernames and known public channel link forms, normalized to one identity', () => {
  for (const value of ['@CreditNews','creditnews','https://t.me/CreditNews','t.me/creditnews/','https://t.me/s/CreditNews','https://telegram.me/creditnews']) {
    assert.equal(normalizeTelegramChannel(value),'creditnews');
  }
});
test('rejects private invites, post URLs, external hosts, credentials and arbitrary paths', () => {
  for (const value of ['', '@ab', '12345', 'https://t.me/+secret', 'https://t.me/joinchat/abcde', 'https://t.me/c/123/5', 'https://t.me/creditnews/100', 'https://evil.example/creditnews', 'https://t.me.evil.example/creditnews', 'https://t.me@evil.example/creditnews','https://user:pass@t.me/creditnews','https://t.me:444/creditnews','https://t.me/creditnews?before=1','https://t.me/creditnews#fragment','https://t.me/share']) {
    assert.equal(normalizeTelegramChannel(value),null,value);
  }
});
