import assert from "node:assert/strict";

import { type Options, type Query } from "@anthropic-ai/claude-agent-sdk";
import { test, vi } from "vitest";

import {
  fakeClaudePath,
  readyClaudeCli,
} from "../../../../../../tests/support/claude-cli.js";
import type { ModelChoice } from "../../../../../shared/providers/types.js";
import {
  settingsDefaults,
  withSetting,
} from "../../../../../shared/settings/settings-schema.js";
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
      setPermissionMode: async () => {},
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
  assert.equal(options!.pathToClaudeCodeExecutable, fakeClaudePath);
  assert.deepEqual(options!.tools, []);
  assert.deepEqual(options!.settingSources, ["user", "project", "local"]);
  assert.deepEqual(options!.settings, { disableAllHooks: true });
  assert.equal(options!.persistSession, false);
  assert.equal(options!.strictMcpConfig, true);
  // Discovery uses the same environment as tasks.
  assert.equal(options!.env!.USER_TOOLCHAIN_HOME, "/synthetic/toolchain");
  assert.equal(options!.env!.SUBAGENT_EXTENSION_FOR_CODEX_TOKEN, undefined);
  const next = discoveryPrompt![Symbol.asyncIterator]().next();
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

  const launches: Options[] = [];
  const releases: ((models: ModelChoice[]) => void)[] = [];
  const failures: ((error: Error) => void)[] = [];

  const provider = new ClaudeAgentProvider(({ options }) => {
    launches.push(options!);

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
    launches.map((options) => options.settingSources),
    [["user", "project", "local"], []],
  );

  const loadedFailure = assert.rejects(loaded, /settings discovery failed/);
  failures[0]!(new Error("settings discovery failed"));

  releases[1]!([
    { value: "isolated-model", displayName: "Isolated", description: "" },
  ]);

  await loadedFailure;
  assert.equal((await unloaded)[0]!.value, "isolated-model");
  assert.equal((await provider.models(isolated))[0]!.value, "isolated-model");
  await assert.rejects(provider.models(defaults), /settings discovery failed/);
  assert.equal(launches.length, 2);
});
