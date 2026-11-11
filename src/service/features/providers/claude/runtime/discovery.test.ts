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
  catalog = models,
  applied,
}: {
  policy?: object;
  rejected?: string[];
  resolved?: object[];
  /** How long Claude Code takes to answer, in milliseconds. */
  modelsAfter?: number;
  catalog?: object[];
  /** What the session reports it will run. */
  applied?: { model: string; effort: string | null };
}) {
  const launch = () => ({
    supportedModels: () =>
      new Promise((resolve) => setTimeout(() => resolve(catalog), modelsAfter)),
    setPermissionMode: async (mode: string) => {
      if (rejected.includes(mode)) throw new Error(REJECTIONS[mode]);
    },
    getSettings: async () => ({
      effective: {},
      ...(applied ? { applied } : {}),
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

test("auto mode turned off under permissions names the organization", async () => {
  const policy = await discovery({
    policy: { permissions: { disableAutoMode: "disable" } },
    rejected: ["auto"],
  }).policy();

  assert.equal(policy?.blocked[0]?.reason, "Turned off by your organization");
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

/** Claude Code's catalog, whose Default describes its own default model. */
const defaultCatalog = [
  {
    value: "default",
    resolvedModel: "claude-opus-5-5",
    displayName: "Default (recommended)",
    description: "Use the default model (currently Opus 5.5)",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5-5",
    displayName: "Sonnet",
    description: "",
    supportedEffortLevels: ["low", "medium", "high"],
  },
];

const defaultEntry = (read: ClaudeDiscovery) =>
  read.models().then((list) => list.find(({ value }) => value === "default"));

test("the org's default model and reasoning reach the Default entry and the policy", async () => {
  const read = discovery({
    policy: {
      model: "sonnet",
      modelSettings: { "claude-sonnet-5-5": { effortLevel: "low" } },
    },
    catalog: defaultCatalog,
    applied: { model: "claude-sonnet-5-5", effort: "low" },
  });

  assert.deepEqual(await defaultEntry(read), {
    ...defaultCatalog[0],
    resolvedModel: "claude-sonnet-5-5",
    description:
      "Use the default model (currently Sonnet) · Set by your organization",
    supportsEffort: undefined,
    supportedEffortLevels: ["low", "medium", "high"],
  });

  const policy = await read.policy();
  assert.equal(policy?.default_model, "Sonnet");
  assert.equal(policy?.default_effort, "low");
});

test("a default from the user's settings doesn't name the organization", async () => {
  const read = discovery({
    catalog: defaultCatalog,
    applied: { model: "claude-sonnet-5-5", effort: "medium" },
  });

  assert.equal(
    (await defaultEntry(read))?.description,
    "Use the default model (currently Sonnet)",
  );
});
