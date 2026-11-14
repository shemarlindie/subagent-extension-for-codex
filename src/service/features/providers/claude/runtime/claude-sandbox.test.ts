import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { test, vi } from "vitest";

import { parity, runWithPolicy } from "./claude-test-harness.js";

test("default settings leave the sandbox and tools to the user's configuration and route prompts to the approver", async () => {
  vi.stubEnv("USER_TOOLCHAIN_HOME", "/synthetic/toolchain");
  vi.stubEnv("SUBAGENT_EXTENSION_FOR_CODEX_TOKEN", "synthetic-service-token");
  vi.stubEnv("OPENAI_API_KEY", "synthetic-app-key");
  const { options, check, decide, asked } = await runWithPolicy(parity);
  assert.equal(options.sandbox, undefined);
  assert.equal(options.managedSettings, undefined);
  assert.deepEqual(options.tools, { type: "preset", preset: "claude_code" });
  assert.deepEqual(options.disallowedTools, []);
  assert.ok(options.env);
  assert.equal(options.env.USER_TOOLCHAIN_HOME, "/synthetic/toolchain");

  for (const name of ["SUBAGENT_EXTENSION_FOR_CODEX_TOKEN", "OPENAI_API_KEY"]) {
    assert.equal(options.env[name], undefined, name);
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

  assert.deepEqual(asked, ["WebFetch", "Agent", "NotebookEdit", "Read"]);
});

test("the sandbox setting turns on Claude Code's sandbox, and subagents can be turned off", async () => {
  const sandboxed = await runWithPolicy({ ...parity, sandbox: true });

  assert.deepEqual(sandboxed.options.sandbox, {
    enabled: true,
    failIfUnavailable: true,
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
