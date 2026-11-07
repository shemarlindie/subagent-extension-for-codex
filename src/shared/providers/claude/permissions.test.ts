import assert from "node:assert/strict";

import { test } from "vitest";

import { exceedsPermission, resolveClaudePermission } from "./permissions.js";

test("model-selected modes cannot exceed the concrete extension setting", () => {
  for (const mode of ["plan", "dontAsk", "default"] as const) {
    assert.equal(exceedsPermission(mode, "default"), false, mode);
  }

  for (const mode of ["acceptEdits", "auto", "bypassPermissions"] as const) {
    assert.equal(exceedsPermission(mode, "default"), true, mode);
  }

  assert.equal(exceedsPermission("default", "acceptEdits"), false);
  assert.equal(exceedsPermission("auto", "acceptEdits"), true);
});

test("read-only profiles default to plan mode, and a task's own mode wins", () => {
  for (const role of ["researcher", "reviewer", "security_reviewer"]) {
    assert.deepEqual(resolveClaudePermission({}, "acceptEdits", role), {
      mode: "plan",
      source: "profile",
    });
  }

  assert.deepEqual(resolveClaudePermission({}, "acceptEdits", "implementer"), {
    mode: "acceptEdits",
    source: "setting",
  });

  assert.deepEqual(
    resolveClaudePermission(
      { permission_mode: "default" },
      "acceptEdits",
      "reviewer",
    ),
    { mode: "default", source: "task" },
  );
});
