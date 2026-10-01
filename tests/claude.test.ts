import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, symlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  ClaudeAgentProvider,
  claudeEnvironment,
  claudeSandbox,
} from "../src/providers/claude.js";
import { startSchema, now, type Task, type RunContext } from "../src/model.js";
import { type Options, type Query } from "@anthropic-ai/claude-agent-sdk";
const result = {
  summary: "Reviewed",
  findings: ["Missing check"],
  evidence: ["a.ts:1"],
  changes: [],
  tests: [],
  recommendations: [],
};
async function context() {
  const workspace = await mkdtemp(join(tmpdir(), "claude-contract-"));
  execFileSync("git", ["init", "-q", workspace]);
  await writeFile(join(workspace, "a.ts"), "test");
  const task: Task = {
    ...startSchema.parse({ task: "Review", worker_profile: "reviewer" }),
    repository: workspace,
    id: "task-test",
    owner: "alice",
    status: "running",
    created_at: now(),
    updated_at: now(),
    instructions: [],
    attempt: 1,
    runtime_ms: 0,
    workspace,
    cost_usd: 1,
    session_id: "existing-session",
  };
  const events: any[] = [];
  const sessions: any[] = [];
  const c: RunContext = {
    task,
    signal: new AbortController().signal,
    emit: (type, data) => events.push({ type, data }),
    session: (id, ref) => sessions.push({ id, ref }),
    input: async () => ({ approved: false, message: "User declined" }),
  };
  return { c, events, sessions, workspace };
}
test("Claude SDK query uses native harness, resume, structured output, remaining budget and profile restrictions", async () => {
  const { c, events, sessions } = await context();
  let options: Options | undefined;
  let closed = false;
  const provider = new ClaudeAgentProvider((args) => {
    options = args.options;
    const messages = (async function* () {
      yield {
        type: "system",
        subtype: "init",
        session_id: "existing-session",
        model: "configured-model",
        tools: ["Read"],
      };
      yield {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Inspecting" },
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file_path: "a.ts" },
            },
          ],
        },
      };
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "existing-session",
        structured_output: result,
        total_cost_usd: 0.1,
        usage: {},
      };
    })();
    return Object.assign(messages, {
      close: () => (closed = true),
    }) as unknown as Query;
  });
  assert.deepEqual(await provider.run(c, "Review"), result);
  assert.equal(options!.cwd, c.task.workspace);
  assert.equal(options!.resume, "existing-session");
  assert.equal(options!.maxBudgetUsd, 4);
  assert.ok(
    options!.tools instanceof Array && !options!.tools.includes("Bash"),
  );
  assert.deepEqual(options!.settingSources, []);
  assert.equal(options!.strictMcpConfig, true);
  assert.deepEqual(options!.mcpServers, {});
  assert.ok(sessions.length);
  assert.ok(events.find((e) => e.type === "tool.started"));
  assert.ok(closed);
});
test("Claude mandatory hook denies outside paths, symlink escapes, Git metadata and disallowed tools", async () => {
  const { c, workspace } = await context();
  await symlink(tmpdir(), join(workspace, "escape"));
  let options: Options | undefined;
  const provider = new ClaudeAgentProvider((args) => {
    options = args.options;
    return Object.assign(
      (async function* () {
        yield {
          type: "result",
          subtype: "success",
          structured_output: result,
          total_cost_usd: 0,
          usage: {},
        };
      })(),
      { close: () => {} },
    ) as unknown as Query;
  });
  await provider.run(c, "Review");
  const hook = options!.hooks!.PreToolUse![0].hooks[0];
  const check = async (tool: string, input: object) => {
    const r = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: tool,
        tool_input: input,
        session_id: "x",
        transcript_path: "x",
        cwd: workspace,
        tool_use_id: "x",
      },
      "x",
      { signal: c.signal },
    );
    return (r as any).hookSpecificOutput?.permissionDecision;
  };
  assert.equal(
    await check("Read", { file_path: join(tmpdir(), "secret") }),
    "deny",
  );
  assert.equal(
    await check("Read", { file_path: join(workspace, "escape", "secret") }),
    "deny",
  );
  assert.equal(
    await check("Read", { file_path: join(workspace, ".git") }),
    "deny",
  );
  assert.equal(await check("Bash", { command: "pwd" }), "deny");
  assert.equal(await check("Write", { file_path: "a.ts" }), "deny");
  assert.equal(await check("Agent", {}), "deny");
  assert.equal(await check("Read", { file_path: "a.ts" }), undefined);
});
test("write-profile shell commands require human decision and cannot use edited approval payloads", async () => {
  const { c } = await context();
  c.task.worker_profile = "implementer";
  let options: Options | undefined;
  const provider = new ClaudeAgentProvider((args) => {
    options = args.options;
    return Object.assign(
      (async function* () {
        yield {
          type: "result",
          subtype: "success",
          structured_output: result,
          total_cost_usd: 0,
          usage: {},
        };
      })(),
      { close: () => {} },
    ) as unknown as Query;
  });
  await provider.run(c, "Implement");
  const command = { command: "npm test" };
  const denied = await options!.canUseTool!("Bash", command, {
    signal: c.signal,
    toolUseID: "tool",
  });
  assert.equal(denied.behavior, "deny");
  c.input = async () => ({
    approved: true,
    input: { command: "other command" },
  });
  const approved = await options!.canUseTool!("Bash", command, {
    signal: c.signal,
    toolUseID: "tool",
  });
  assert.equal(approved.behavior, "allow");
  assert.deepEqual((approved as any).updatedInput, command);
});
test("Claude failed result accounts for cost and never reports task success", async () => {
  const { c, events } = await context();
  const provider = new ClaudeAgentProvider(
    () =>
      Object.assign(
        (async function* () {
          yield {
            type: "result",
            subtype: "error_max_budget_usd",
            errors: ["Limit reached"],
            session_id: "x",
            total_cost_usd: 0.3,
            usage: {},
          };
        })(),
        { close: () => {} },
      ) as unknown as Query,
  );
  await assert.rejects(provider.run(c, "Review"), /error_max_budget/);
  assert.equal(
    events.find((e) => e.type === "agent.completed")?.data.cost_usd,
    0.3,
  );
});

test("Claude omits its native cost ceiling only when the task explicitly disables it", async () => {
  const { c } = await context();
  c.task.budget.max_cost_usd = null;
  let options: Options | undefined;
  const provider = new ClaudeAgentProvider((args) => {
    options = args.options;
    const messages = (async function* () {
      yield {
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: "existing-session",
        structured_output: result,
        total_cost_usd: 0.1,
        usage: {},
      };
    })();
    return Object.assign(messages, { close: () => {} }) as unknown as Query;
  });
  assert.deepEqual(await provider.run(c, "Review"), result);
  assert.equal(Object.hasOwn(options!, "maxBudgetUsd"), false);
});

test("Claude runtime environment excludes service and other-provider credentials at the real SDK spawn boundary", async () => {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const env = claudeEnvironment({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ANTHROPIC_API_KEY: "synthetic-claude-key",
    CLAUDE_CONFIG_DIR: "/synthetic/claude-state",
    OPENAI_API_KEY: "synthetic-app-key",
    OPENAI_EXECUTOR_API_KEY: "synthetic-executor-key",
    CODEX_SUBAGENT_EXTENSION_TOKEN: "synthetic-service-token",
    SSH_AUTH_SOCK: "/synthetic/ssh-agent",
    AWS_SECRET_ACCESS_KEY: "synthetic-cloud-key",
    NODE_OPTIONS: "--require /untrusted.js",
    HTTPS_PROXY: "http://synthetic-proxy-credential@example.invalid",
  });
  let spawned: Record<string, string | undefined> | undefined;
  await assert.rejects(async () => {
    const stream = query({
      prompt: "Never executed",
      options: {
        env,
        spawnClaudeCodeProcess: (options) => {
          spawned = options.env;
          throw new Error("Synthetic spawn refusal; no process or model call");
        },
      },
    });
    try {
      for await (const _ of stream) {
      }
    } finally {
      stream.close();
    }
  }, /Synthetic spawn refusal/);
  assert.ok(spawned);
  assert.equal(spawned.ANTHROPIC_API_KEY, "synthetic-claude-key");
  assert.equal(spawned.CLAUDE_CONFIG_DIR, "/synthetic/claude-state");
  assert.equal(spawned.PATH, process.env.PATH);
  for (const name of [
    "OPENAI_API_KEY",
    "OPENAI_EXECUTOR_API_KEY",
    "CODEX_SUBAGENT_EXTENSION_TOKEN",
    "SSH_AUTH_SOCK",
    "AWS_SECRET_ACCESS_KEY",
    "NODE_OPTIONS",
    "HTTPS_PROXY",
  ])
    assert.equal(
      spawned[name],
      undefined,
      `${name} must not reach the native harness`,
    );
});

test("Claude SDK serializes mandatory native Bash sandbox restrictions without enabling automatic or unsandboxed execution", async () => {
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
      }
    } finally {
      stream.close();
    }
  }, /Sandbox serialization probe only/);
  assert.ok(args);
  const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
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

test("native StructuredOutput accepts only the result contract while other reporting tools stay denied", async () => {
  const { c } = await context();
  let options: Options | undefined;
  const provider = new ClaudeAgentProvider((args) => {
    options = args.options;
    return Object.assign(
      (async function* () {
        yield {
          type: "result",
          subtype: "success",
          structured_output: result,
          total_cost_usd: 0,
          usage: {},
        };
      })(),
      { close: () => {} },
    ) as unknown as Query;
  });
  await provider.run(c, "Report");
  const hook = options!.hooks!.PreToolUse![0].hooks[0];
  const check = (name: string, params: object) =>
    hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: name,
        tool_input: params,
        session_id: "x",
        transcript_path: "x",
        cwd: c.task.workspace!,
        tool_use_id: "x",
      },
      "x",
      { signal: c.signal },
    );
  const permission = (name: string, input: object) =>
    options!.canUseTool!(name, input as Record<string, unknown>, {
      signal: c.signal,
      toolUseID: "x",
    });
  assert.deepEqual(await check("StructuredOutput", result), {});
  assert.equal(
    (await permission("StructuredOutput", result)).behavior,
    "allow",
  );
  for (const invalid of [
    { summary: "Missing report fields" },
    { ...result, command: "unrelated shell command" },
  ]) {
    assert.equal(
      ((await check("StructuredOutput", invalid)) as any).hookSpecificOutput
        .permissionDecision,
      "deny",
    );
    assert.equal(
      (await permission("StructuredOutput", invalid)).behavior,
      "deny",
    );
  }
  assert.equal(
    (await permission("mcp__unconfigured__report", result)).behavior,
    "deny",
  );
});
