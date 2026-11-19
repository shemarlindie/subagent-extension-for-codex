import assert from "node:assert/strict";

import { test } from "vitest";

import { signInExpiry } from "./sign-in-expiry";

const DAY_MS = 86_400_000;
const now = Date.parse("2026-11-18T12:00:00Z");
const inDays = (days: number) => new Date(now + days * DAY_MS).toISOString();

test("a sign-in warns from 10 days before it ends", () => {
  assert.equal(signInExpiry(undefined, now), undefined);
  assert.equal(signInExpiry("not a date", now), undefined);
  assert.equal(signInExpiry(inDays(10.001), now), undefined);

  assert.deepEqual(signInExpiry(inDays(10), now), {
    endsAt: inDays(10),
    ended: false,
  });

  assert.equal(signInExpiry(inDays(0), now)?.ended, true);
});
