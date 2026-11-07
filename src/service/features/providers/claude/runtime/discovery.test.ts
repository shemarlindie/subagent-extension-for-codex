import assert from "node:assert/strict";
import { tmpdir } from "node:os";

import type { query, resolveSettings } from "@anthropic-ai/claude-agent-sdk";
import { onTestFinished, test, vi } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import { claudeOverrideDefaults } from "../../../../../shared/providers/claude/permissions.js";
import { ClaudeDiscovery } from "./discovery.js";

const models = [{ value: "haiku", displayName: "Haiku", description: "" }];

/** Rejections as Claude Code words them. */
const REJECTIONS: Partial<Record<string, string>> = {
  bypassPermissions:
    "Cannot set permission mode to bypassPermissions because it is disabled by settings or configuration",
  auto: "Cannot set permission mode to auto: auto mode disabled by settings",
};

const orgPolicy = {
  permissions: { disableBypassPermissionsMode: "disable" },
  disableAutoMode: "disable",
};

function discovery({
  policy,
  rejected = [],
  resolved = [],
  modelsAfter = 0,
}: {
  policy?: object;
  rejected?: string[];
  resolved?: object[];
  /** How long Claude Code takes to answer, in milliseconds. */
  modelsAfter?: number;
}) {
  const launch = () => ({
    supportedModels: () =>
      new Promise((resolve) => setTimeout(() => resolve(models), modelsAfter)),
    setPermissionMode: async (mode: string) => {
      if (rejected.includes(mode)) throw new Error(REJECTIONS[mode]);
    },
    getSettings: async () => ({
      effective: {},
      sources: [
        { source: "flagSettings", settings: {} },
        ...(policy ? [{ source: "policySettings", settings: policy }] : []),
      ],
    }),
    close: () => {},
  });

  return new ClaudeDiscovery(
    launch as unknown as typeof query,
    readyClaudeCli,
    claudeOverrideDefaults,
    (async () => ({
      effective: {},
      sources: resolved,
    })) as unknown as typeof resolveSettings,
  );
}

const blockedModes = (policy: Awaited<ReturnType<ClaudeDiscovery["policy"]>>) =>
  policy?.blocked.map((item) => item.value);

test("no policy reports nothing, so nothing reads as allowed by an organization", async () => {
  assert.equal(await discovery({}).policy(), undefined);
});

test("discovery outlasts Claude Code's wait for a hung org policy fetch", async () => {
  vi.useFakeTimers();

  onTestFinished(() => {
    vi.useRealTimers();
  });

  const read = discovery({ modelsAfter: 30_000 }).models();
  await vi.advanceTimersByTimeAsync(30_000);

  assert.deepEqual(await read, models);
});

test("modes the session rejects are blocked, naming the organization when its policy did it", async () => {
  const policy = await discovery({
    policy: orgPolicy,
    rejected: ["bypassPermissions", "auto"],
  }).policy();

  assert.deepEqual(blockedModes(policy), ["auto", "bypassPermissions"]);

  assert.equal(policy?.blocked[0]?.reason, "Turned off by your organization");
  assert.equal(policy?.managed, true);
});

test("discovery runs outside any project, without the Bypass flag as root", async () => {
  let options: { cwd?: string; allowDangerouslySkipPermissions?: boolean } = {};

  const launch = (args: { options: typeof options }) => {
    options = args.options;

    return {
      supportedModels: async () => models,
      close: () => {},
    };
  };

  const read = () =>
    new ClaudeDiscovery(
      launch as unknown as typeof query,
      readyClaudeCli,
      claudeOverrideDefaults,
    ).models();

  await read();
  assert.equal(options.cwd, tmpdir());
  assert.equal(options.allowDangerouslySkipPermissions, true);

  vi.spyOn(process, "getuid").mockReturnValue(0);
  vi.stubEnv("IS_SANDBOX", "");

  onTestFinished(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  await read();
  assert.equal(options.allowDangerouslySkipPermissions, false);

  // Claude Code only accepts this exact value.
  vi.stubEnv("IS_SANDBOX", "0");
  await read();
  assert.equal(options.allowDangerouslySkipPermissions, false);

  vi.stubEnv("IS_SANDBOX", "1");
  await read();
  assert.equal(options.allowDangerouslySkipPermissions, true);
});

test("a session that ends during the policy read keeps its models and is retried soon", async () => {
  let reads = 0;

  const launch = () => ({
    supportedModels: async () => models,
    setPermissionMode: async () => {
      reads += 1;
      if (reads === 1) throw new Error("Query closed before response received");
    },
    getSettings: async () => ({
      effective: {},
      sources: [{ source: "policySettings", settings: orgPolicy }],
    }),
    close: () => {},
  });

  const reader = new ClaudeDiscovery(
    launch as unknown as typeof query,
    readyClaudeCli,
    claudeOverrideDefaults,
    (async () => ({
      effective: {},
      sources: [],
    })) as unknown as typeof resolveSettings,
  );

  const started = Date.now();
  const clock = vi.spyOn(Date, "now");
  onTestFinished(() => clock.mockRestore());
  clock.mockReturnValue(started);

  assert.deepEqual(await reader.models(), models);
  assert.equal(await reader.policy(), undefined);

  clock.mockReturnValue(started + 60_000);
  assert.equal((await reader.policy())?.managed, true);
});

test("a mode blocked outside policy doesn't name the organization", async () => {
  const policy = await discovery({ rejected: ["auto"] }).policy();

  assert.deepEqual(policy, {
    managed: false,
    blocked: [
      {
        value: "auto",
        reason: "Not available with your Claude Code setup",
      },
    ],
    notes: [],
  });
});

test("policy only the session sees is the console's, and policy on this computer is the device's", async () => {
  assert.equal(
    (await discovery({ policy: orgPolicy }).policy())?.source,
    "console",
  );

  assert.equal(
    (
      await discovery({
        policy: orgPolicy,
        resolved: [{ source: "managed", policyOrigin: "file", settings: {} }],
      }).policy()
    )?.source,
    "device",
  );
});

test("the allowlist and other active policy reach the panel", async () => {
  const policy = await discovery({
    policy: {
      availableModels: ["haiku"],
      availableModelsMatch: "exact",
      allowManagedHooksOnly: true,
      allowManagedPermissionRulesOnly: true,
    },
  }).policy();

  assert.deepEqual(policy?.available_models, ["haiku"]);
  assert.equal(policy?.available_models_match, "exact");

  assert.deepEqual(
    policy?.notes.map((note) => note.label),
    ["Hooks", "Permission rules"],
  );
});
