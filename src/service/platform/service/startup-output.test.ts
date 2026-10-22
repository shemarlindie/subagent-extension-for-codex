import assert from "node:assert/strict";

import { test } from "vitest";

import { formatStartupOutput, formatStartupPrompt } from "./startup-output.js";

test("startup output adds a leading blank only when requested", () => {
  const blocks = [{ type: "message", text: "Ready" }] as const;

  assert.equal(
    formatStartupOutput(blocks, { leadingBlank: true }),
    "\nReady\n",
  );

  assert.equal(formatStartupOutput(blocks), "Ready\n");
});

test("separates prompts and hangs wrapped lines beneath the first line", () => {
  const lines = formatStartupPrompt(
    "Send SIGTERM to this process and retry startup?",
    40,
  ).split("\n");

  assert.equal(lines[0], "");
  assert.match(lines[1] ?? "", /^\S/);
  assert.match(lines[2] ?? "", /^ {2}\S/);
  assert.match(lines.at(-1) ?? "", /\[y\/N\] $/);
});
