import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, vi } from "vitest";

import { claudeSandbox } from "../configuration/execution-environment.js";
import { context, parity, runWithPolicy } from "./claude-test-harness.js";

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

test("Claude frames the general profile as a coding agent and lets it write", async () => {
  const { options } = await runWithPolicy(parity, "general"),
    { append } = options.systemPrompt as { append: string };

  assert.match(append, /You are an independent coding agent\./);
  assert.match(append, /Follow the configured native permission mode/);
});

test("Claude parity policy leaves sandbox, tools and paths to the user's configuration and routes prompts to the approver", async () => {
  vi.stubEnv("USER_TOOLCHAIN_HOME", "/synthetic/toolchain");
  vi.stubEnv("CODEX_SUBAGENT_EXTENSION_TOKEN", "synthetic-service-token");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-app-key");
  vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "synthetic-subscription-token");
  const { options, check, decide, asked } = await runWithPolicy(parity);
  assert.equal(options.sandbox, undefined);
  assert.equal(options.managedSettings, undefined);
  assert.deepEqual(options.tools, { type: "preset", preset: "claude_code" });
  assert.deepEqual(options.disallowedTools, []);
  assert.equal(options.env!.USER_TOOLCHAIN_HOME, "/synthetic/toolchain");

  for (const name of [
    "CODEX_SUBAGENT_EXTENSION_TOKEN",
    "OPENAI_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
  ]) {
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
