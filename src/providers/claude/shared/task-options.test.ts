import { expect, test } from "vitest";

import {
  claudeStartOptionsSchema,
  claudeTaskOptionsSchema,
  readClaudeTaskOptions,
} from "./task-options.js";

const policy = {
  sandbox: true,
  subagents: false,
  settings_files: true,
  user_mcp: true,
};

/** A complete stored task's options. */
const stored = {
  permission_mode: "plan",
  approval_decider: "user",
  permission_source: "task",
  claude_policy: policy,
};

// Starting a task accepts `inherit`; a stored task holds the resolved mode.
const optionSchemas = [
  [claudeStartOptionsSchema, {}],
  [claudeTaskOptionsSchema, stored],
] as const;

test("a stored task rejects missing state, an unresolved permission mode or an unknown source", () => {
  expect(
    claudeStartOptionsSchema.parse({ permission_mode: "inherit" }),
  ).toEqual({ permission_mode: "inherit" });

  for (const options of [
    {},
    { ...stored, permission_mode: "inherit" },
    { ...stored, permission_source: "default" },
  ]) {
    expect(claudeTaskOptionsSchema.safeParse(options).success).toBe(false);
  }
});

test.each(optionSchemas)(
  "rejects unknown fields and invalid permission or approval values",
  (schema, base) => {
    expect(schema.parse(base)).toEqual(base);

    expect(
      schema.safeParse({ ...base, bypass_permissions: true }).success,
    ).toBe(false);

    for (const permission_mode of ["bypass_permissions", true]) {
      expect(schema.safeParse({ ...base, permission_mode }).success).toBe(
        false,
      );
    }

    for (const approval_decider of ["auto", false]) {
      expect(schema.safeParse({ ...base, approval_decider }).success).toBe(
        false,
      );
    }
  },
);

test("keeps policy validation and nested unknown-field stripping", () => {
  expect(
    claudeTaskOptionsSchema.parse({
      ...stored,
      claude_policy: { ...policy, unexpected: true },
    }),
  ).toEqual(stored);

  for (const claude_policy of [
    { ...policy, sandbox: "extension" },
    { ...policy, subagents: "on" },
  ]) {
    expect(
      claudeTaskOptionsSchema.safeParse({ ...stored, claude_policy }).success,
    ).toBe(false);
  }

  expect(
    claudeStartOptionsSchema.safeParse({ claude_policy: policy }).success,
  ).toBe(false);
});

test("reads and validates only the Claude provider's options", () => {
  const options = { ...stored, approval_decider: "parent_agent" };

  expect(
    readClaudeTaskOptions({
      provider_options: { other: { unexpected: true }, claude: options },
    }),
  ).toEqual(options);

  expect(() =>
    readClaudeTaskOptions({ provider_options: { other: options } }),
  ).toThrow();

  expect(() =>
    readClaudeTaskOptions({
      provider_options: { claude: { ...stored, permission_mode: "invalid" } },
    }),
  ).toThrow();
});
