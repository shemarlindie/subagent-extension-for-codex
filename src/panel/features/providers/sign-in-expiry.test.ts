import assert from "node:assert/strict";

import { test } from "vitest";

import { nextExpiryChange, signInExpiry } from "./sign-in-expiry";

const DAY_MS = 86_400_000;
const now = Date.parse("2026-11-18T12:00:00Z");
const inDays = (days: number) => new Date(now + days * DAY_MS).toISOString();

test("a sign-in shows nothing when its end is unknown or more than 10 days away", () => {
  assert.equal(signInExpiry(undefined, now), undefined);
  assert.equal(signInExpiry("not a date", now), undefined);
  assert.equal(signInExpiry(inDays(10.001), now), undefined);
});

test("a sign-in within 10 days ends in a window starting 3 days before its date", () => {
  assert.deepEqual(signInExpiry(inDays(9), now), {
    state: "soon",
    earliest: inDays(6),
    latest: inDays(9),
  });

  assert.equal(signInExpiry(inDays(3.5), now)?.state, "imminent");
  assert.equal(signInExpiry(inDays(0), now)?.state, "ended");
});

test("each next change lands on the time the warning starts, turns imminent, or ends", () => {
  const expiresAt = inDays(12);
  const states = [];
  let time = nextExpiryChange(expiresAt, now);

  // A timer fires exactly on the change, so the new state must apply then.
  while (time !== undefined) {
    states.push([(time - now) / DAY_MS, signInExpiry(expiresAt, time)?.state]);
    time = nextExpiryChange(expiresAt, time);
  }

  assert.deepEqual(states, [
    [2, "soon"],
    [8, "imminent"],
    [12, "ended"],
  ]);

  assert.equal(nextExpiryChange(undefined, now), undefined);
});
