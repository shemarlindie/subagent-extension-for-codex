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

test("a cache expires at its TTL, and a task without a record has none", () => {
  const cache = task({
    requested_at: new Date(start).toISOString(),
    ttl: "5m",
  });

  assert.deepEqual(promptCacheLeft(cache, minutes(4)), {
    state: "warm",
    ms: 60_000,
    ttl: "5m",
  });

  assert.deepEqual(promptCacheLeft(cache, minutes(5)), { state: "expired" });
  assert.equal(promptCacheEnd(cache), minutes(5));
  assert.equal(promptCacheLeft(task(), start), undefined);
});
