import assert from "node:assert/strict";

import { test } from "vitest";

import { workerChoice } from "./delegation";

test("a worker choice splits at its first colon into provider and profile", () => {
  assert.deepEqual(workerChoice("claude:reviewer"), {
    provider: "claude",
    profile: "reviewer",
  });

  assert.deepEqual(workerChoice("claude"), { provider: "claude" });

  assert.deepEqual(workerChoice("claude:"), {
    provider: "claude",
    profile: "",
  });
});
