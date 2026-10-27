import assert from "node:assert/strict";

import { test } from "vitest";

import { settingsDefaults } from "../../../shared/settings/settings-schema";
import { Controller } from "../../app/state/controller";
import type { Transport } from "../../app/state/types";
import { delegationDialog } from "./delegation";

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
      settingsDefaults("claude"),
      false,
    );

    assert.equal(dialog.repository, "/remaining");
    assert.equal(dialog.revision, "HEAD");
  } finally {
    controller.dispose();
  }
});
