import { expect, test } from "vitest";
import { z } from "zod";

import {
  approvalDeciderSchema,
  claudePermissionModeSchema,
  permissionModeSchema,
} from "./permissions.js";
import { readClaudeTaskOptions } from "./task-options.js";
import {
  claudeStartOptionsSchema,
  claudeTaskOptionsSchema,
} from "./task-options-contract.generated.js";

const policy = {
  sandbox: "extension_locked",
  environment: "filtered",
  tools: "restricted",
  path_guard: true,
  subagents: false,
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
  [claudeStartOptionsSchema, permissionModeSchema, {}],
  [claudeTaskOptionsSchema, claudePermissionModeSchema, stored],
] as const;

test("a stored task rejects missing state, an unresolved permission mode or an unknown source", () => {
  expect(
    claudeStartOptionsSchema.parse({ permission_mode: "inherit" }),
  ).toEqual({ permission_mode: "inherit" });

  for (const options of [
    {},
    { ...stored, permission_mode: "inherit" },
    { ...stored, permission_source: "user_config" },
  ]) {
    expect(claudeTaskOptionsSchema.safeParse(options).success).toBe(false);
  }
});

test.each(optionSchemas)(
  "accepts all permission modes and approval deciders and rejects unknown fields",
  (schema, modes, base) => {
    expect(schema.parse(base)).toEqual(base);

    for (const permission_mode of modes.options) {
      for (const approval_decider of approvalDeciderSchema.options) {
        const input = { ...base, permission_mode, approval_decider };

        expect(schema.parse(input)).toEqual(input);

        expect(
          schema.safeParse({ ...input, bypass_permissions: true }).success,
        ).toBe(false);
      }
    }

    for (const permission_mode of [
      "root",
      "allowAll",
      "bypass_permissions",
      true,
    ]) {
      expect(schema.safeParse({ ...base, permission_mode }).success).toBe(
        false,
      );
    }

    for (const approval_decider of ["auto", "system", "none", false]) {
      expect(schema.safeParse({ ...base, approval_decider }).success).toBe(
        false,
      );
    }
  },
);

test("retains handwritten permission enum metadata in generated JSON Schema", () => {
  for (const [schema, modes] of optionSchemas) {
    const json = z.toJSONSchema(schema);

    expect(json.properties?.permission_mode).toMatchObject({
      type: "string",
      enum: modes.options,
    });

    expect(json.properties?.approval_decider).toMatchObject({
      type: "string",
      enum: approvalDeciderSchema.options,
    });

    expect(json.additionalProperties).toBe(false);
  }
});

test("keeps policy validation and nested unknown-field stripping", () => {
  expect(
    claudeTaskOptionsSchema.parse({
      ...stored,
      claude_policy: { ...policy, unexpected: true },
    }),
  ).toEqual(stored);

  for (const claude_policy of [
    { ...policy, tools: "profile" },
    { ...policy, tools: "unrestricted" },
    { ...policy, sandbox: "disabled" },
    { ...policy, sandbox: false },
  ]) {
    expect(
      claudeTaskOptionsSchema.safeParse({ ...stored, claude_policy }).success,
    ).toBe(false);
  }

  expect(
    claudeStartOptionsSchema.safeParse({ claude_policy: policy }).success,
  ).toBe(false);
});

test("reads only the Claude provider's options through the generated validator", () => {
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
