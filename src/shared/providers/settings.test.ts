import assert from "node:assert/strict";

import { test } from "vitest";

import { validateProviderSettingsUpdate } from "./settings.js";

test("provider-owned restriction updates retain user-only authority", () => {
  assert.throws(
    () => validateProviderSettingsUpdate({ claude_tools: "all" }, "parent"),
    /Claude session restrictions require a user decision/,
  );

  assert.throws(
    () =>
      validateProviderSettingsUpdate(
        { claude_permission_mode: "bypassPermissions" },
        "parent",
      ),
    /Approval settings require a user decision/,
  );

  assert.doesNotThrow(() =>
    validateProviderSettingsUpdate({ claude_tools: "all" }, "user"),
  );
});
