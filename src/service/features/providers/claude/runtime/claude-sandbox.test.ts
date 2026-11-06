import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  query,
  SDKUserMessage,
  Settings,
} from "@anthropic-ai/claude-agent-sdk";
import { test, vi } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import type { ClaudePolicy } from "../../../../../shared/providers/claude/permissions.js";
import { claudeSandbox } from "../configuration/execution-environment.js";
import {
  context,
  parity,
  reply,
  runWithPolicy,
  setClaudeOptions,
} from "./claude-test-harness.js";
import { ClaudeAgentProvider } from "./provider.js";

test("Claude SDK serializes the extension Bash sandbox without enabling automatic or unsandboxed execution", async () => {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const { c, workspace } = await context();
  const sandbox = await claudeSandbox(c.task);
  let args: string[] | undefined;

  await assert.rejects(async () => {
    const stream = query({
      prompt: "Never executed",
      options: {
        cwd: workspace,
        sandbox,
        spawnClaudeCodeProcess: (options) => {
          args = options.args;
          throw new Error("Sandbox serialization probe only");
        },
      },
    });

    try {
      for await (const _ of stream) {
        // Drain the stream.
      }
    } finally {
      stream.close();
    }
  }, /Sandbox serialization probe only/);

  assert.ok(args);
  const settingsArg = args[args.indexOf("--settings") + 1];
  assert.ok(settingsArg);
  const settings = JSON.parse(settingsArg);
  assert.equal(settings.sandbox.enabled, true);
  assert.equal(settings.sandbox.failIfUnavailable, true);
  assert.equal(settings.sandbox.autoAllowBashIfSandboxed, false);
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  assert.deepEqual(settings.sandbox.excludedCommands, []);
  assert.deepEqual(settings.sandbox.network.allowedDomains, []);
  assert.equal(settings.sandbox.network.allowAllUnixSockets, false);
  const canonicalWorkspace = await realpath(workspace);

  assert.deepEqual(settings.sandbox.filesystem.allowWrite, [
    canonicalWorkspace,
  ]);

  assert.ok(
    settings.sandbox.filesystem.denyWrite.includes(
      join(canonicalWorkspace, ".git"),
    ),
  );

  assert.ok(settings.sandbox.filesystem.allowRead.includes(canonicalWorkspace));
  assert.ok(settings.sandbox.filesystem.denyRead.includes(canonicalWorkspace));
});

test("The extension sandbox reads no Git metadata for a folder without Git and blocks creating it", async () => {
  const { c, workspace } = await context();
  const canonical = await realpath(workspace);

  const { filesystem } = await claudeSandbox({ ...c.task, no_git: true });

  assert.deepEqual(filesystem?.allowRead, [canonical]);
  assert.deepEqual(filesystem?.allowWrite, [canonical]);
  assert.deepEqual(filesystem?.denyWrite, [join(canonical, ".git")]);
});

test("The extension sandbox denies reads of a data directory outside home by its real path", async (t) => {
  const data = await mkdtemp(
    join(tmpdir(), "subagent-extension-for-codex-data-"),
  );

  t.onTestFinished(() => rm(data, { recursive: true, force: true }));
  const { c } = await context();
  vi.stubEnv("SUBAGENT_EXTENSION_FOR_CODEX_DATA", data);

  assert.ok(
    (await claudeSandbox(c.task)).filesystem!.denyRead!.includes(
      await realpath(data),
    ),
  );
});

test("Claude parity policy leaves sandbox, tools and paths to the user's configuration and routes prompts to the approver", async () => {
  vi.stubEnv("USER_TOOLCHAIN_HOME", "/synthetic/toolchain");
  vi.stubEnv("SUBAGENT_EXTENSION_FOR_CODEX_TOKEN", "synthetic-service-token");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-app-key");
  const { options, check, decide, asked } = await runWithPolicy(parity);
  assert.equal(options.sandbox, undefined);
  assert.equal(options.managedSettings, undefined);
  assert.deepEqual(options.tools, { type: "preset", preset: "claude_code" });
  assert.deepEqual(options.disallowedTools, []);
  assert.equal(options.env!.USER_TOOLCHAIN_HOME, "/synthetic/toolchain");

  for (const name of ["SUBAGENT_EXTENSION_FOR_CODEX_TOKEN", "OPENAI_API_KEY"]) {
    assert.equal(options.env![name], undefined, name);
  }

  for (const [tool, input] of [
    ["WebFetch", { url: "https://example.com" }],
    ["Agent", { prompt: "Look" }],
    ["NotebookEdit", { notebook_path: join(tmpdir(), "x.ipynb") }],
    ["Read", { file_path: join(tmpdir(), "outside") }],
  ] as const) {
    assert.equal(await check(tool, input), undefined, tool);
    assert.equal(await decide(tool, input), "allow", tool);
  }

  // Without a path guard, outside reads are not auto-approved.
  assert.deepEqual(asked, ["WebFetch", "Agent", "NotebookEdit", "Read"]);
});

test("Claude path guard and restricted tools apply independently when enabled", async () => {
  const guarded = await runWithPolicy({ ...parity, path_guard: true });
  assert.equal(await guarded.check("WebFetch", { url: "x" }), undefined);

  assert.equal(
    await guarded.check("NotebookEdit", {
      notebook_path: join(tmpdir(), "x.ipynb"),
    }),
    "deny",
  );

  assert.equal(
    await guarded.decide("Read", { file_path: join(tmpdir(), "outside") }),
    "deny",
  );

  assert.equal(await guarded.decide("Read", { file_path: "a.ts" }), "allow");

  assert.equal(
    await guarded.decide("Write", { file_path: join(guarded.workspace, "b") }),
    "allow",
  );

  assert.deepEqual(guarded.asked, ["Write"]);

  const restricted = await runWithPolicy({ ...parity, tools: "restricted" });

  assert.ok(
    Array.isArray(restricted.options.tools) &&
      restricted.options.tools.includes("Bash") &&
      !restricted.options.tools.includes("WebFetch"),
  );

  assert.equal(await restricted.check("WebFetch", { url: "x" }), "deny");
  assert.equal(await restricted.decide("WebFetch", { url: "x" }), "deny");
  assert.equal(await restricted.check("mcp__server__tool", {}), undefined);

  assert.equal(
    await restricted.check("Read", { file_path: join(tmpdir(), "outside") }),
    undefined,
  );

  const loosenedReviewer = await runWithPolicy(parity, "reviewer");

  assert.equal(
    await loosenedReviewer.check("Bash", { command: "pwd" }),
    undefined,
  );

  assert.deepEqual(loosenedReviewer.options.disallowedTools, []);
});

test("Claude extension sandbox modes add the sandbox and lock network domains at the policy tier", async () => {
  const extension = await runWithPolicy({ ...parity, sandbox: "extension" });
  assert.equal(extension.options.sandbox?.enabled, true);
  assert.equal(extension.options.managedSettings, undefined);

  const locked = await runWithPolicy({
    ...parity,
    sandbox: "extension_locked",
  });

  assert.equal(locked.options.sandbox?.failIfUnavailable, true);

  assert.deepEqual(locked.options.managedSettings, {
    sandbox: { network: { allowManagedDomainsOnly: true } },
  });

  const noSubagents = await runWithPolicy({ ...parity, subagents: false });
  assert.deepEqual(noSubagents.options.disallowedTools, ["Agent", "Task"]);
});

test("settings choose whether sessions load Claude Code settings and their MCP servers", async () => {
  const loaded = await runWithPolicy(parity);
  assert.deepEqual(loaded.options.settingSources, ["user", "project", "local"]);
  assert.equal(loaded.options.strictMcpConfig, undefined);

  // Without settings, servers from other MCP configuration stay out too.
  const noSettings = await runWithPolicy({ ...parity, settings_files: false });
  assert.deepEqual(noSettings.options.settingSources, []);
  assert.equal(noSettings.options.strictMcpConfig, true);

  const noUserMcp = await runWithPolicy({ ...parity, user_mcp: false });

  assert.deepEqual(noUserMcp.options.settingSources, [
    "user",
    "project",
    "local",
  ]);

  assert.equal(noUserMcp.options.strictMcpConfig, true);
});

/** A turn against a session that reports `settings`, tracking what reached it. */
async function sandboxTurn(
  sandbox: ClaudePolicy["sandbox"],
  settings?: () => Promise<{ effective: Settings }>,
) {
  const { c } = await context();

  setClaudeOptions(c.task, {
    permission_mode: "default",
    claude_policy: { ...parity, sandbox },
  });

  const sent: string[] = [];
  let held = 0;

  c.promptHeld = () => {
    held += 1;
  };

  const launch = (args: { prompt: AsyncIterable<SDKUserMessage> }) =>
    Object.assign(
      (async function* () {
        for await (const message of args.prompt) {
          sent.push(message.message.content as string);

          yield {
            type: "result",
            subtype: "success",
            result: reply,
            total_cost_usd: 0,
            usage: {},
          };
        }
      })(),
      { close: () => {}, ...(settings ? { getSettings: settings } : {}) },
    );

  const provider = new ClaudeAgentProvider(
    launch as unknown as typeof query,
    undefined,
    readyClaudeCli,
  );

  return { c, sent, held: () => held, run: () => provider.run(c, "Prompt") };
}

const effectiveSandbox = (sandbox: Settings["sandbox"]) => async () => ({
  effective: { sandbox },
});

const asked = {
  enabled: true,
  failIfUnavailable: true,
  allowUnsandboxedCommands: false,
};

test("a sandboxed task fails before its prompt when policy turns the sandbox off", async () => {
  const { run, sent, held } = await sandboxTurn(
    "extension",
    effectiveSandbox({ ...asked, enabled: false }),
  );

  await assert.rejects(run, /organization's policy turns the sandbox off/);
  assert.deepEqual(sent, []);
  assert.equal(held(), 1);
});

test("a locked-network task fails before its prompt when an admin policy drops the lock", async () => {
  const { run, sent } = await sandboxTurn(
    "extension_locked",
    effectiveSandbox(asked),
  );

  await assert.rejects(run, /doesn't let the extension lock it/);
  assert.deepEqual(sent, []);
});

test("a locked-network task runs when the effective settings keep the lock", async () => {
  const { run, sent, held } = await sandboxTurn(
    "extension_locked",
    effectiveSandbox({
      ...asked,
      network: { allowManagedDomainsOnly: true },
    }),
  );

  assert.deepEqual(await run(), { reply });
  assert.deepEqual(sent, ["Prompt"]);
  assert.equal(held(), 0);
});

test("a sandboxed task fails when Claude Code can't report its settings, and other tasks don't ask", async () => {
  const missing = await sandboxTurn("extension");
  await assert.rejects(missing.run, /didn't confirm it's on/);
  assert.deepEqual(missing.sent, []);

  const failing = await sandboxTurn("extension", () =>
    Promise.reject(new Error("Unsupported")),
  );

  await assert.rejects(failing.run, /didn't confirm it's on/);

  const unsandboxed = await sandboxTurn("user_config");
  assert.deepEqual(await unsandboxed.run(), { reply });
  assert.deepEqual(unsandboxed.sent, ["Prompt"]);
});

test("each turn checks the sandbox again, so policy that arrives between turns stops the next one", async () => {
  let sandbox: Settings["sandbox"] = asked;

  const turn = await sandboxTurn("extension", async () => ({
    effective: { sandbox },
  }));

  assert.deepEqual(await turn.run(), { reply });
  sandbox = { ...asked, enabled: false };
  await assert.rejects(turn.run, /turns the sandbox off/);
  assert.deepEqual(turn.sent, ["Prompt"]);
});

test("an interrupt during the sandbox check sends no prompt", async () => {
  const controller = new AbortController();

  const { c, run, sent } = await sandboxTurn("extension", async () => {
    controller.abort();

    return { effective: { sandbox: asked } };
  });

  c.signal = controller.signal;
  await assert.rejects(run, /without a result/);
  assert.deepEqual(sent, []);
});
