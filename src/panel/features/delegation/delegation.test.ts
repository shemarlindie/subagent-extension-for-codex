import assert from "node:assert/strict";

import { test } from "vitest";

import { Controller } from "../../app/state/controller";
import type { Transport } from "../../app/state/types";
import { delegationDialog, workerChoice } from "./delegation";

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

test("New task does not reuse a revoked scoped repository", () => {
  const controller = new Controller({
    embedded: true,
    dispose() {},
  } as Transport);

  try {
    const state = {
      ...controller.getSnapshot(),
      repository: "/removed",
      workers: [
        { provider: "claude", profiles: ["reviewer"], capabilities: {} },
      ],
    };

    const dialog = delegationDialog(
      state,
      [{ repository: "/remaining", kind: "repository" }],
      {
        default_provider: "claude",
        default_worker_profile: "reviewer",
        max_runtime_minutes: 20,
        max_cost_usd: null,
      },
      false,
    );

    assert.equal(dialog.repository, "/remaining");
    assert.equal(dialog.revision, "HEAD");
  } finally {
    controller.dispose();
  }
});
