import { expect, expectTypeOf, test } from "vitest";
import { z } from "zod";

import { approvalDeciderSchema, permissionModeSchema } from "./permissions.js";
import { readClaudeTaskOptions } from "./task-options.js";
import {
  claudeStartOptionsSchema,
  claudeTaskOptionsSchema,
} from "./task-options-contract.generated.js";
import type {
  ClaudeStartOptions,
  ClaudeTaskOptions,
} from "./task-options-contract.js";

const policy = {
  sandbox: "extension_locked",
  environment: "filtered",
  tools: "restricted",
  path_guard: true,
  subagents: false,
};

test("generated Claude option outputs match source contracts", () => {
  expectTypeOf<
    z.output<typeof claudeStartOptionsSchema>
  >().toEqualTypeOf<ClaudeStartOptions>();

  expectTypeOf<
    z.output<typeof claudeTaskOptionsSchema>
  >().toEqualTypeOf<ClaudeTaskOptions>();
});

test.each([claudeStartOptionsSchema, claudeTaskOptionsSchema])(
  "accepts all permission modes and approval deciders and rejects unknown fields",
  (schema) => {
    expect(schema.parse({})).toEqual({});

    for (const permission_mode of permissionModeSchema.options) {
      for (const approval_decider of approvalDeciderSchema.options) {
        const input = { permission_mode, approval_decider };

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
      expect(schema.safeParse({ permission_mode }).success).toBe(false);
    }

    for (const approval_decider of ["auto", "system", "none", false]) {
      expect(schema.safeParse({ approval_decider }).success).toBe(false);
    }
  },
);

test("retains handwritten permission enum metadata in generated JSON Schema", () => {
  for (const schema of [claudeStartOptionsSchema, claudeTaskOptionsSchema]) {
    const json = z.toJSONSchema(schema);

    expect(json.properties?.permission_mode).toMatchObject({
      type: "string",
      enum: permissionModeSchema.options,
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
      permission_source: "task_profile",
      claude_policy: { ...policy, unexpected: true },
    }),
  ).toEqual({ permission_source: "task_profile", claude_policy: policy });

  for (const claude_policy of [
    { ...policy, tools: "profile" },
    { ...policy, tools: "unrestricted" },
    { ...policy, sandbox: "disabled" },
    { ...policy, sandbox: false },
  ]) {
    expect(claudeTaskOptionsSchema.safeParse({ claude_policy }).success).toBe(
      false,
    );
  }

  expect(
    claudeStartOptionsSchema.safeParse({ claude_policy: policy }).success,
  ).toBe(false);
});

test("reads only the Claude provider's options through the generated validator", () => {
  const options = {
    permission_mode: "plan",
    approval_decider: "parent_agent",
    permission_source: "task",
    claude_policy: policy,
  };

  expect(
    readClaudeTaskOptions({
      provider_options: { other: { unexpected: true }, claude: options },
    }),
  ).toEqual(options);

  expect(
    readClaudeTaskOptions({ provider_options: { other: options } }),
  ).toEqual({});

  expect(() =>
    readClaudeTaskOptions({
      provider_options: { claude: { permission_mode: "invalid" } },
    }),
  ).toThrow();
});
