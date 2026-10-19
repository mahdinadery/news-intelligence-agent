/**
 * Deterministic short-link slugs — server-side helper (unit-testable).
 *
 * Same URL always maps to the same slug (idempotent across rebuilds and
 * re-sends), so one target URL never floods the table with duplicates. The
 * slug is a base62 slice of a SHA-256 digest — no external shortener, no
 * counter race; collisions are handled by the caller with a salted retry.
 *
 * Number-based (no BigInt) so this stays compatible with the project's
 * TypeScript target: 6 digest bytes = 48 bits < MAX_SAFE_INTEGER and enough
 * entropy for an 8-char base62 slug (62^8 ≈ 2.2e14).
 */

import { createHash } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SLUG_LENGTH = 8;

function toBase62(value: number): string {
  if (value <= 0) return "0";
  let rest = Math.floor(value);
  let out = "";
  while (rest > 0) {
    out = ALPHABET[rest % ALPHABET.length] + out;
    rest = Math.floor(rest / ALPHABET.length);
  }
  return out;
}

/**
 * Stable 8-char base62 slug for one URL. `salt` only changes the outcome for
 * the rare slug-vs-slug collision retry (never for normal lookups).
 */
export function slugForUrl(url: string, salt = ""): string {
  const digest = createHash("sha256").update(`${url}\u0000${salt}`).digest();
  const value = digest.readUIntBE(0, 6);
  return toBase62(value).padStart(SLUG_LENGTH, "0").slice(0, SLUG_LENGTH);
}
