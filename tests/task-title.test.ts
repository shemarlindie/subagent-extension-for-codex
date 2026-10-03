import { test } from "node:test";
import assert from "node:assert/strict";
import { generateTaskTitle } from "../src/core/task-title.js";

test("generated titles summarize the first request line and normalize whitespace", () => {
  assert.equal(
    generateTaskTitle(
      " \n\t Review   authentication. Follow up on authorization.\nKeep all evidence.",
    ),
    "Review authentication.",
  );
  assert.equal(
    generateTaskTitle("Inspect\t\tall permissions\nThen report every finding"),
    "Inspect all permissions",
  );
  assert.equal(
    generateTaskTitle(
      "Investigate version 1.2 regressions? Include reproduction steps.",
    ),
    "Investigate version 1.2 regressions?",
  );
});

test("long generated titles fit the heading limit while the request remains intact", () => {
  const description =
    "Review " +
    "authentication permissions ".repeat(12) +
    "and report all findings.";
  const title = generateTaskTitle(description);
  assert.ok(title.length <= 120);
  assert.ok(title.endsWith("…"));
  assert.ok(description.startsWith(title.slice(0, -1)));
  assert.ok(description.slice(title.length - 1).startsWith(" "));
  const uninterrupted = generateTaskTitle("x".repeat(300));
  assert.equal(uninterrupted, "x".repeat(119) + "…");
});

test("truncated generated titles preserve complete emoji at the heading limit", () => {
  for (const description of [
    "x".repeat(118) + "😀" + "x".repeat(100),
    "😀".repeat(80),
  ]) {
    const title = generateTaskTitle(description);
    assert.ok(title.length <= 120);
    assert.ok(title.endsWith("…"));
    assert.ok(title.isWellFormed());
    assert.ok(description.startsWith(title.slice(0, -1)));
  }
});
