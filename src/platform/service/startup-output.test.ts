import assert from "node:assert/strict";

import { test } from "vitest";

import { formatStartupOutput, formatStartupPrompt } from "./startup-output.js";

test("formats messages, fields, warnings, and commands as separated blocks", () => {
  const output = formatStartupOutput(
    [
      { type: "message", text: "A live service owns this directory." },
      {
        type: "fields",
        fields: [
          { label: "PID", value: "1234" },
          { label: "Lock file", value: "/tmp/" + "long-path/".repeat(12) },
        ],
      },
      { type: "message", text: "Could not verify the process identity." },
      { type: "command", text: "kill -TERM 1234" },
    ],
    { leadingBlank: true, width: 40 },
  );

  assert.match(
    output,
    /^\nA live service owns this directory\.\n\n {2}PID: 1234/,
  );

  assert.match(output, / {2}Lock file: .+\n {13}\S/);

  assert.match(
    output,
    /\n\nCould not verify the process identity\.\n\n {2}kill -TERM 1234\n$/,
  );
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
