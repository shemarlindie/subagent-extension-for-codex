import assert from "node:assert/strict";

import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import { test } from "vitest";

import { readClaudeTaskOptions } from "../../../../../providers/claude/shared/task-options.js";
import {
  claudeOptions,
  context,
  setClaudeOptions,
} from "./claude-test-harness.js";
import { modelHonored, recordEffectiveSettings } from "./effective-settings.js";

const orgPolicy = {
  getSettings: async () => ({
    effective: {},
    sources: [
      {
        source: "policySettings",
        settings: {
          permissions: { disableBypassPermissionsMode: "disable" as const },
          availableModels: ["sonnet"],
        },
      },
    ],
  }),
};

const init = { permissionMode: "default", model: "claude-opus-5-5" };

async function bypassTask() {
  const ctx = await context();
  setClaudeOptions(ctx.c.task, { permission_mode: "bypassPermissions" });
  ctx.c.task.model = "opus";

  return ctx;
}

const limited = (events: { type: string; data: unknown }[]) =>
  events.filter((event) => event.type === "agent.limited");

function limitReason(events: { type: string; data: unknown }[]) {
  const [event] = limited(events);
  assert.ok(event, "The task must record a limit event");

  return (event.data as { reason: string }).reason;
}

test("a task that asked for a blocked mode records both modes and reports it once, even when resumed", async () => {
  const { c, events } = await bypassTask();

  await recordEffectiveSettings(c, init, orgPolicy);
  await recordEffectiveSettings(c, init, orgPolicy);

  assert.equal(
    readClaudeTaskOptions(c.task).permission_mode,
    "bypassPermissions",
  );

  assert.deepEqual(claudeOptions(c.task).effective, {
    permission_mode: "default",
  });

  assert.deepEqual(limited(events), [
    {
      type: "agent.limited",
      data: {
        setting: "permission_mode",
        requested: "bypassPermissions",
        effective: "default",
        reason:
          "Running with Ask for approval. Your organization turned off Bypass permission prompts.",
      },
    },
  ]);
});

test("a mode change names the organization only when policy turned that mode off", async () => {
  const { c, events } = await bypassTask();

  await recordEffectiveSettings(c, init, { getSettings: undefined });

  assert.match(
    limitReason(events),
    /Claude Code doesn't allow Bypass permission prompts for this session/,
  );
});

test("a limit that lifts is cleared, and reports again if it returns", async () => {
  const { c, events } = await bypassTask();

  await recordEffectiveSettings(c, init, orgPolicy);

  await recordEffectiveSettings(
    c,
    { ...init, permissionMode: "bypassPermissions" },
    orgPolicy,
  );

  assert.deepEqual(claudeOptions(c.task).effective, {});

  await recordEffectiveSettings(c, init, orgPolicy);
  assert.equal(limited(events).length, 2);
});

test("a swapped model is reported, and an alias or a blank model isn't", async () => {
  for (const [requested, actual] of [
    [undefined, "claude-opus-5-5"],
    ["default", "claude-opus-5-5"],
    ["opusplan", "claude-sonnet-5-5"],
    ["opus", "claude-opus-5-5"],
    ["opus[1m]", "claude-opus-5-5[1m]"],
    ["claude-opus-5-5", "claude-opus-5-5"],
    ["claude-opus-5-5-fast", "claude-opus-5-5"],
    ["sonnet", "custom-deployment-id"],
  ] as const) {
    assert.ok(modelHonored(requested, actual), `${requested} on ${actual}`);
  }

  assert.ok(!modelHonored("opus", "claude-sonnet-5-5"));
  assert.ok(!modelHonored("claude-opus-5-5", "claude-opus-5"));
  assert.ok(!modelHonored("claude-opus-5-5", "custom-deployment-id"));

  const { c, events } = await context();
  setClaudeOptions(c.task, { permission_mode: "default" });
  c.task.model = "opus";

  await recordEffectiveSettings(
    c,
    { permissionMode: "default", model: "claude-sonnet-5-5" },
    orgPolicy,
  );

  assert.deepEqual(claudeOptions(c.task).effective, {
    model: "claude-sonnet-5-5",
  });

  assert.equal(c.task.model, "opus");

  assert.equal(
    limitReason(events),
    "Running with claude-sonnet-5-5. Your organization doesn't allow opus.",
  );
});

test("reasoning the session lowers is recorded and reported, naming the org's cap when policy sets one", async () => {
  const session = (policy: Settings) => ({
    getSettings: async () => ({
      effective: {},
      applied: { model: "claude-opus-5-5", effort: "high" },
      sources: [{ source: "policySettings", settings: policy }],
    }),
  });

  const { c, events } = await context();
  setClaudeOptions(c.task, { permission_mode: "default" });
  c.task.model = "opus";
  c.task.reasoning_effort = "xhigh";

  await recordEffectiveSettings(
    c,
    { permissionMode: "default", model: "claude-opus-5-5" },
    session({ maxEffortLevel: "high" }),
  );

  assert.deepEqual(claudeOptions(c.task).effective, { effort: "high" });

  assert.deepEqual(limited(events)[0]?.data, {
    setting: "reasoning_effort",
    requested: "xhigh",
    effective: "high",
    reason:
      "Running with High reasoning. Your organization doesn't allow Xhigh.",
  });

  const plain = await context();
  setClaudeOptions(plain.c.task, { permission_mode: "default" });
  plain.c.task.reasoning_effort = "xhigh";

  await recordEffectiveSettings(
    plain.c,
    { permissionMode: "default", model: "claude-opus-5-5" },
    session({}),
  );

  assert.equal(
    limitReason(plain.events),
    "Running with High reasoning instead of Xhigh.",
  );
});

test("a Default task records the model and reasoning it ran, without a report", async () => {
  const { c, events } = await context();
  setClaudeOptions(c.task, { permission_mode: "default" });
  c.task.model = "default";
  c.task.reasoning_effort = "default";

  await recordEffectiveSettings(
    c,
    { permissionMode: "default", model: "claude-opus-5-5" },
    {
      getSettings: async () => ({
        effective: {},
        applied: { model: "claude-opus-5-5", effort: "medium" },
      }),
    },
  );

  assert.deepEqual(claudeOptions(c.task).effective, {
    model: "claude-opus-5-5",
    effort: "medium",
  });

  assert.deepEqual(limited(events), []);
});
