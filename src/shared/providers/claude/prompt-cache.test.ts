import assert from "node:assert/strict";

import { test } from "vitest";

import { claudeOverrideDefaults, resolveClaudePolicy } from "./permissions.js";
import { promptCacheEnd, promptCacheLeft } from "./prompt-cache.js";

const start = Date.parse("2026-11-14T12:00:00.000Z");
const minutes = (n: number) => start + n * 60_000;

const task = (prompt_cache?: object) => ({
  provider_options: {
    claude: {
      permission_mode: "default",
      permission_source: "setting",
      approval_decider: "user",
      claude_policy: resolveClaudePolicy(claudeOverrideDefaults),
      ...(prompt_cache ? { prompt_cache } : {}),
    },
  },
});

test("a partial cache's tail expires at its TTL and the earlier part an hour after the request", () => {
  const partial = task({
    requested_at: new Date(start).toISOString(),
    ttl: "5m",
    partial: true,
  });

  assert.deepEqual(promptCacheLeft(partial, minutes(4)), {
    state: "warm",
    ms: 60_000,
    ttl: "5m",
    earlierMs: 56 * 60_000,
  });

  assert.deepEqual(promptCacheLeft(partial, minutes(20)), {
    state: "partial",
    ms: 40 * 60_000,
  });

  assert.deepEqual(promptCacheLeft(partial, minutes(60)), {
    state: "expired",
  });

  assert.equal(promptCacheEnd(partial), minutes(60));
});

test("a whole cache expires at its TTL, and a task without a record has none", () => {
  const whole = task({
    requested_at: new Date(start).toISOString(),
    ttl: "5m",
  });

  assert.deepEqual(promptCacheLeft(whole, minutes(5)), { state: "expired" });
  assert.equal(promptCacheEnd(whole), minutes(5));
  assert.equal(promptCacheLeft(task(), start), undefined);
});
