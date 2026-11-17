import assert from "node:assert/strict";

import { type Options, type Query } from "@anthropic-ai/claude-agent-sdk";
import { test, vi } from "vitest";

import {
  fakeClaudePath,
  readyClaudeCli,
} from "../../../../../../tests/support/claude-cli.js";
import {
  claudeOverrideDefaults,
  resolveClaudePolicy,
} from "../../../../../shared/providers/claude/permissions.js";
import type { ModelChoice } from "../../../../../shared/providers/types.js";
import {
  settingsDefaults,
  withSetting,
} from "../../../../../shared/settings/settings-schema.js";
import type { Task } from "../../../../../shared/tasks/model.js";
import { ClaudeAgentProvider } from "./provider.js";

test("Claude model discovery coalesces requests, caches five minutes and submits no user turn", async () => {
  let time = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => time);
  vi.stubEnv("USER_TOOLCHAIN_HOME", "/synthetic/toolchain");
  vi.stubEnv("SUBAGENT_EXTENSION_FOR_CODEX_TOKEN", "synthetic-service-token");
  let launches = 0;
  let closes = 0;
  let resolve!: (models: any[]) => void;

  const pending = new Promise<any[]>((r) => {
    resolve = r;
  });

  let discoveryPrompt: AsyncIterable<any> | undefined;
  let options: Options | undefined;

  const models = [
    {
      value: "discovered-model",
      displayName: "Discovered model",
      description: "SDK metadata",
    },
  ];

  const provider = new ClaudeAgentProvider((args) => {
    launches++;
    discoveryPrompt = args.prompt as AsyncIterable<any>;
    options = args.options;

    return {
      supportedModels: () => pending,
      getSettings: async () => ({ effective: {} }),
      close: () => {
        closes++;
      },
    } as unknown as Query;
  }, readyClaudeCli);

  const first = provider.models();
  void provider.models();
  // The launch follows the executable check.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(launches, 1);
  assert.ok(options?.env);
  assert.ok(discoveryPrompt);
  assert.equal(options.pathToClaudeCodeExecutable, fakeClaudePath);
  assert.deepEqual(options.tools, []);
  assert.deepEqual(options.settingSources, ["user", "project", "local"]);
  assert.deepEqual(options.settings, { disableAllHooks: true });
  assert.equal(options.persistSession, false);
  assert.equal(options.strictMcpConfig, true);
  // Discovery uses the same environment as tasks.
  assert.equal(options.env.USER_TOOLCHAIN_HOME, "/synthetic/toolchain");
  assert.equal(options.env.SUBAGENT_EXTENSION_FOR_CODEX_TOKEN, undefined);
  const next = discoveryPrompt[Symbol.asyncIterator]().next();
  let emitted = false;

  void next.then(() => {
    emitted = true;
  });

  await Promise.resolve();
  assert.equal(emitted, false);
  resolve(models);
  assert.deepEqual(await first, models);
  assert.deepEqual(await next, { done: true, value: undefined });
  assert.equal(closes, 1);
  const [cached] = await provider.models();
  assert.ok(cached);
  assert.equal(cached.supportsEffort, undefined);
  assert.equal(cached.supportedEffortLevels, undefined);
  time += 5 * 60 * 1000 - 1;
  await provider.models();
  assert.equal(launches, 1);
  time++;
  await provider.models();
  assert.equal(launches, 2);
  assert.equal(closes, 2);
});

test("Claude model discovery reads in a project folder, caching each folder and settings-file choice", async () => {
  const folders: (string | undefined)[] = [];

  const provider = new ClaudeAgentProvider((args) => {
    folders.push(args.options?.cwd);

    return {
      supportedModels: async () => [],
      getSettings: async () => ({ effective: {} }),
      close: () => {},
    } as unknown as Query;
  }, readyClaudeCli);

  const settings = settingsDefaults("claude");

  const noFiles = withSetting(
    settings,
    "providers.claude.settings_files",
    false,
  );

  await provider.models(settings, "/repo/a");
  await provider.policy(settings, "/repo/a");
  await provider.models(noFiles, "/repo/a");
  await provider.models(settings, "/repo/b");
  await provider.models(settings);

  assert.equal(folders.length, 4);
  assert.deepEqual(folders.slice(0, 3), ["/repo/a", "/repo/a", "/repo/b"]);
  assert.notEqual(folders[3], "/repo/a");
});

test("Claude command discovery reads the task's folder as its session would, keeping Claude Code's row for a shared name", async () => {
  const launches: Options[] = [];

  const command = (name: string, builtin?: boolean) => ({
    name,
    description: builtin ? "Built in" : "Skill",
    argumentHint: "",
    ...(builtin ? { builtin } : {}),
  });

  const provider = new ClaudeAgentProvider(({ options }) => {
    if (options) launches.push(options);

    return {
      supportedCommands: async () => [
        command("review", false),
        command("review", true),
        { ...command("usage", true), aliases: ["cost"] },
      ],
      close() {},
    } as unknown as Query;
  }, readyClaudeCli);

  const task = {
    repository: "/repo",
    provider_options: {
      claude: {
        permission_mode: "plan",
        approval_decider: "user",
        permission_source: "task",
        claude_policy: resolveClaudePolicy({
          ...claudeOverrideDefaults,
          settings_files: false,
        }),
      },
    },
  } as unknown as Task;

  assert.deepEqual(await provider.commands(task), [
    {
      name: "review",
      description: "Built in",
      argument_hint: "",
      aliases: [],
      builtin: true,
    },
    {
      name: "usage",
      description: "Built in",
      argument_hint: "",
      aliases: ["cost"],
      builtin: true,
    },
  ]);

  await provider.commands({ ...task, workspace: "/worktree" });

  assert.deepEqual(
    launches.map(({ cwd, settingSources, tools }) => [
      cwd,
      settingSources,
      tools,
    ]),
    [
      ["/repo", [], []],
      ["/worktree", [], []],
    ],
  );
});

test("failed Claude model discovery closes the query and retries after a short cooldown", async () => {
  let time = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => time);
  let attempts = 0;
  let closes = 0;

  const provider = new ClaudeAgentProvider(() => {
    const attempt = ++attempts;

    return {
      supportedModels: async () => {
        if (attempt === 1) throw new Error("SDK discovery failed");

        return [
          { value: "retried-model", displayName: "Retried", description: "" },
        ];
      },
      close: () => {
        closes++;
      },
    } as unknown as Query;
  }, readyClaudeCli);

  await assert.rejects(provider.models(), /SDK discovery failed/);
  assert.equal(closes, 1);
  await assert.rejects(provider.models(), /SDK discovery failed/);
  assert.equal(attempts, 1);
  assert.equal(closes, 1);
  time += 30000;
  const [retried] = await provider.models();
  assert.ok(retried);
  assert.equal(retried.value, "retried-model");
  assert.equal(attempts, 2);
  assert.equal(closes, 2);
});

test("Claude discovery keeps concurrent requests, results and failures separate by settings", async () => {
  const defaults = settingsDefaults("claude");

  const isolated = withSetting(
    defaults,
    "providers.claude.settings_files",
    false,
  );

  const launches: (Options | undefined)[] = [];
  const releases: ((models: ModelChoice[]) => void)[] = [];
  const failures: ((error: Error) => void)[] = [];

  const provider = new ClaudeAgentProvider(({ options }) => {
    launches.push(options);

    const result = new Promise<ModelChoice[]>((resolve, reject) => {
      releases.push(resolve);
      failures.push(reject);
    });

    return { supportedModels: () => result, close() {} } as unknown as Query;
  }, readyClaudeCli);

  const loaded = provider.models(defaults);
  const unloaded = provider.models(isolated);
  void provider.models({ ...isolated });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(launches.length, 2);

  assert.deepEqual(
    launches.map((options) => options?.settingSources),
    [["user", "project", "local"], []],
  );

  const loadedFailure = assert.rejects(loaded, /settings discovery failed/);
  const [fail] = failures;
  const [, release] = releases;
  assert.ok(fail && release);
  fail(new Error("settings discovery failed"));

  release([
    { value: "isolated-model", displayName: "Isolated", description: "" },
  ]);

  await loadedFailure;
  assert.equal((await unloaded)[0]?.value, "isolated-model");
  assert.equal((await provider.models(isolated))[0]?.value, "isolated-model");
  await assert.rejects(provider.models(defaults), /settings discovery failed/);
  assert.equal(launches.length, 2);
});
