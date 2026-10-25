import assert from "node:assert/strict";

import { test } from "vitest";

import {
  claudeOverrideDefaults,
  exceedsPermission,
  resolveClaudePermission,
  resolveClaudePolicy,
} from "./permissions.js";

test("native permission resolution uses the task mode or the concrete extension setting", () => {
  const task = {};

  assert.deepEqual(resolveClaudePermission(task, "default"), {
    mode: "default",
    source: "setting",
  });

  assert.deepEqual(
    resolveClaudePermission({ permission_mode: "inherit" }, "auto"),
    { mode: "auto", source: "setting" },
  );

  assert.deepEqual(resolveClaudePermission(task, "auto"), {
    mode: "auto",
    source: "setting",
  });

  assert.deepEqual(
    resolveClaudePermission({ permission_mode: "default" }, "dontAsk"),
    { mode: "default", source: "task" },
  );
});

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

test("profile restriction values restrict read-only profiles and explicit values apply to all", () => {
  const profile = {
    ...claudeOverrideDefaults,
    claude_tools: "profile",
    claude_path_guard: "profile",
  } as const;

  for (const role of ["researcher", "reviewer", "security_reviewer"]) {
    assert.deepEqual(
      [
        resolveClaudePolicy(profile, role).tools,
        resolveClaudePolicy(profile, role).path_guard,
      ],
      ["restricted", true],
    );
  }

  for (const role of [
    "general",
    "implementer",
    "debugger",
    "test_engineer",
    "refactorer",
  ]) {
    assert.deepEqual(
      [
        resolveClaudePolicy(profile, role).tools,
        resolveClaudePolicy(profile, role).path_guard,
      ],
      ["all", false],
    );
  }

  const loosened = resolveClaudePolicy(
    { ...profile, claude_tools: "all", claude_path_guard: "off" },
    "reviewer",
  );

  assert.equal(loosened.tools, "all");
  assert.equal(loosened.path_guard, false);
});
