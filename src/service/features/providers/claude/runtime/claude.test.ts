import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type Options, type Query } from "@anthropic-ai/claude-agent-sdk";
import { test, vi } from "vitest";

import {
  fakeClaudePath,
  readyClaudeCli,
} from "../../../../../../tests/support/claude-cli.js";
import {
  claudeOverrideDefaults,
  type ClaudePolicy,
  resolveClaudePolicy,
} from "../../../../../shared/providers/claude/permissions.js";
import { startSchema, type Task } from "../../../../../shared/tasks/model.js";
import { now } from "../../../../../shared/time.js";
import { type RunContext } from "../../types.js";
import {
  claudeEnvironment,
  claudeSandbox,
} from "../configuration/execution-environment.js";
import { ClaudeAgentProvider } from "./provider.js";

const reply = "Reviewed: a.ts:1 is missing a check.";

const setClaudeOptions = (task: Task, patch: Record<string, unknown>) => {
  task.provider_options = {
    ...task.provider_options,
    claude: { ...task.provider_options?.claude, ...patch },
  };
};

const claudeOptions = (task: Task) => task.provider_options?.claude ?? {};

test("Claude session deletion skips absent ids and forwards existing sessions", async () => {
  const task: Task = {
    ...startSchema.parse({ description: "Delete" }),
    title: "Delete",
    id: "delete-task",
    owner: "alice",
    status: "completed",
    created_at: "now",
    updated_at: "now",
    instructions: [],
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
  };

  const calls: string[] = [];

  const provider = new ClaudeAgentProvider(
    undefined,
    async (id) => {
      calls.push(id);
    },
    readyClaudeCli,
  );

  await provider.deleteSession(task);
  assert.deepEqual(calls, []);
  await provider.deleteSession({ ...task, session_id: "session-one" });
  assert.deepEqual(calls, ["session-one"]);
});

test("Claude session deletion only tolerates the SDK's missing-session error", async () => {
  const task: Task = {
    ...startSchema.parse({ description: "Delete" }),
    title: "Delete",
    id: "delete-task",
    owner: "alice",
    status: "completed",
    created_at: "now",
    updated_at: "now",
    instructions: [],
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
    session_id: "session-one",
  };

  const missing = new Error(
    "Session session-one not found in any project directory",
  );

  const absent = new ClaudeAgentProvider(
    undefined,
    async () => {
      throw missing;
    },
    readyClaudeCli,
  );

  await absent.deleteSession(task);

  for (const error of [
    new Error("subagent cleanup failed"),
    new Error("Session other-session not found in any project directory"),
    "cleanup failed",
  ]) {
    const failed = new ClaudeAgentProvider(
      undefined,
      async () => {
        throw error;
      },
      readyClaudeCli,
    );

    for (const session_state_ref of [undefined, "/missing/transcript.jsonl"])
      await assert.rejects(
        failed.deleteSession({ ...task, session_state_ref }),
        (actual: unknown) => actual === error,
      );
  }
});

async function context() {
  const workspace = await mkdtemp(join(tmpdir(), "claude-contract-"));
  execFileSync("git", ["init", "-q", workspace]);
  await writeFile(join(workspace, "a.ts"), "test");

  const task: Task = {
    ...startSchema.parse({
      description: "Review",
      worker_profile: "reviewer",
      provider_options: {
        claude: { permission_mode: "plan", approval_decider: "user" },
      },
    }),
    repository: workspace,
    id: "task-test",
    title: "Review",
    owner: "alice",
    status: "running",
    created_at: now(),
    updated_at: now(),
    instructions: [],
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
    provider_options: {
      claude: {
        permission_mode: "plan",
        approval_decider: "user",
        permission_source: "task_profile",
        claude_policy: resolveClaudePolicy(claudeOverrideDefaults, "reviewer"),
      },
    },
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
    acceptSteers: () => {},
    steerTaken: () => {},
    delta: () => {},
  };

  return { c, events, sessions, workspace };
}

test("Claude model discovery coalesces requests, caches five minutes and submits no user turn", async () => {
  let time = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => time);
  vi.stubEnv("CLAUDE_CODE_USE_BEDROCK", "1");
  vi.stubEnv("CODEX_SUBAGENT_EXTENSION_TOKEN", "synthetic-service-token");
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

  const provider = new ClaudeAgentProvider(
    (args) => {
      launches++;
      discoveryPrompt = args.prompt as AsyncIterable<any>;
      options = args.options;

      return {
        supportedModels: () => pending,
        close: () => {
          closes++;
        },
      } as unknown as Query;
    },
    undefined,
    readyClaudeCli,
  );

  const first = provider.models();
  const second = provider.models();
  assert.equal(first, second);
  // The launch follows the executable check.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(launches, 1);
  assert.equal(options!.pathToClaudeCodeExecutable, fakeClaudePath);
  assert.deepEqual(options!.tools, []);
  assert.deepEqual(options!.settingSources, ["user", "project", "local"]);
  assert.deepEqual(options!.settings, { disableAllHooks: true });
  assert.equal(options!.persistSession, false);
  assert.equal(options!.strictMcpConfig, true);
  // Discovery uses the default task environment, not the filtered allowlist.
  assert.equal(options!.env!.CLAUDE_CODE_USE_BEDROCK, "1");
  assert.equal(options!.env!.CODEX_SUBAGENT_EXTENSION_TOKEN, undefined);
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
  assert.equal((await provider.models())[0].supportsEffort, undefined);
  assert.equal((await provider.models())[0].supportedEffortLevels, undefined);
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

  const provider = new ClaudeAgentProvider(
    () => {
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
    },
    undefined,
    readyClaudeCli,
  );

  await assert.rejects(provider.models(), /SDK discovery failed/);
  assert.equal(closes, 1);
  await assert.rejects(provider.models(), /SDK discovery failed/);
  assert.equal(attempts, 1);
  assert.equal(closes, 1);
  time += 30000;
  assert.equal((await provider.models())[0].value, "retried-model");
  assert.equal(attempts, 2);
  assert.equal(closes, 2);
});

test("Claude SDK query uses native harness, resume, a plain reply, remaining budget and profile restrictions", async () => {
  const { c, events, sessions } = await context();
  let options: Options | undefined;
  let closed = false;

  const provider = new ClaudeAgentProvider(
    (args) => {
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
          result: reply,
          total_cost_usd: 0.1,
          usage: {},
        };
      })();

      return Object.assign(messages, {
        close: () => (closed = true),
      }) as unknown as Query;
    },
    undefined,
    readyClaudeCli,
  );

  assert.deepEqual(await provider.run(c, "Review"), { reply });
  assert.equal(options!.cwd, c.task.workspace);
  assert.equal(options!.resume, "existing-session");
  assert.equal(options!.maxBudgetUsd, 4);

  assert.ok(
    options!.tools instanceof Array && !options!.tools.includes("Bash"),
  );

  assert.deepEqual(options!.settingSources, ["user", "project", "local"]);
  assert.equal(options!.strictMcpConfig, undefined);
  assert.ok(!options!.disallowedTools!.includes("Skill"));
  assert.equal(options!.permissionMode, "plan");
  assert.equal(options!.allowDangerouslySkipPermissions, undefined);
  assert.ok(sessions.length);
  assert.ok(events.find((e) => e.type === "tool.started"));
  assert.ok(closed);
});

test("Claude read-only profile bundle denies outside paths, symlink escapes, Git metadata and disallowed tools", async () => {
  const { c, workspace } = await context();
  await symlink(tmpdir(), join(workspace, "escape"));
  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    (args) => {
      options = args.options;

      return Object.assign(
        (async function* () {
          yield {
            type: "result",
            subtype: "success",
            result: reply,
            total_cost_usd: 0,
            usage: {},
          };
        })(),
        { close: () => {} },
      ) as unknown as Query;
    },
    undefined,
    readyClaudeCli,
  );

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
  assert.equal(await check("mcp__server__tool", {}), "deny");
  assert.equal(await check("Skill", { skill: "review" }), undefined);
  assert.equal(await check("Read", { file_path: "a.ts" }), undefined);
});

test("Claude forwards the selected model and effort and omits inherited native settings", async () => {
  const { c } = await context();
  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    (args) => {
      options = args.options;

      return Object.assign(
        (async function* () {
          yield {
            type: "result",
            subtype: "success",
            result: reply,
            total_cost_usd: 0,
            usage: {},
          };
        })(),
        { close: () => {} },
      ) as unknown as Query;
    },
    undefined,
    readyClaudeCli,
  );

  c.task.model = "selected-model";
  c.task.reasoning_effort = "high";
  await provider.run(c, "Review");
  assert.equal(options!.model, "selected-model");
  assert.equal(options!.effort, "high");
  delete c.task.model;
  c.task.reasoning_effort = "default";
  await provider.run(c, "Review");
  assert.equal(Object.hasOwn(options!, "model"), false);
  assert.equal(Object.hasOwn(options!, "effort"), false);
  delete c.task.reasoning_effort;
  await provider.run(c, "Review");
  assert.equal(Object.hasOwn(options!, "effort"), false);
});

test("write-profile shell commands require human decision and cannot use edited approval payloads", async () => {
  const { c } = await context();
  c.task.worker_profile = "implementer";

  setClaudeOptions(c.task, {
    claude_policy: resolveClaudePolicy(claudeOverrideDefaults, "implementer"),
  });

  setClaudeOptions(c.task, { permission_mode: "inherit" });
  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    (args) => {
      options = args.options;

      return Object.assign(
        (async function* () {
          yield {
            type: "result",
            subtype: "success",
            result: reply,
            total_cost_usd: 0,
            usage: {},
          };
        })(),
        { close: () => {} },
      ) as unknown as Query;
    },
    undefined,
    readyClaudeCli,
  );

  await provider.run(c, "Implement");
  const command = { command: "npm test" };

  const denied = await options!.canUseTool!("Bash", command, {
    signal: c.signal,
    toolUseID: "tool",
    requestId: "request",
  });

  assert.equal(denied!.behavior, "deny");

  c.input = async () => ({
    approved: true,
    input: { command: "other command" },
  });

  const approved = await options!.canUseTool!("Bash", command, {
    signal: c.signal,
    toolUseID: "tool",
    requestId: "request",
  });

  assert.equal(approved!.behavior, "allow");
  assert.deepEqual((approved as any).updatedInput, command);
  // MCP tools follow the same approval routing as shell commands.
  const tool = { query: "status" };

  const mcp = await options!.canUseTool!("mcp__server__tool", tool, {
    signal: c.signal,
    toolUseID: "tool",
    requestId: "request",
  });

  assert.equal(mcp!.behavior, "allow");
  assert.deepEqual((mcp as any).updatedInput, tool);
});

test("Claude forwards each native permission mode and reserves bypass opt-in for bypassPermissions", async () => {
  const { c, workspace } = await context();
  c.task.worker_profile = "implementer";

  setClaudeOptions(c.task, {
    claude_policy: resolveClaudePolicy(claudeOverrideDefaults, "implementer"),
  });

  // Restrictions enabled in settings apply in every native mode.
  setClaudeOptions(c.task, {
    claude_policy: {
      sandbox: "extension",
      environment: "filtered",
      tools: "restricted",
      path_guard: true,
      subagents: false,
    },
  });

  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    (args) => {
      options = args.options;

      return Object.assign(
        (async function* () {
          yield {
            type: "result",
            subtype: "success",
            result: reply,
            total_cost_usd: 0,
            usage: {},
          };
        })(),
        { close: () => {} },
      ) as unknown as Query;
    },
    undefined,
    readyClaudeCli,
  );

  for (const mode of [
    "default",
    "acceptEdits",
    "plan",
    "dontAsk",
    "auto",
    "bypassPermissions",
  ] as const) {
    setClaudeOptions(c.task, { permission_mode: mode });
    await provider.run(c, "Implement");
    assert.equal(options!.permissionMode, mode);

    assert.equal(
      options!.allowDangerouslySkipPermissions,
      mode === "bypassPermissions" ? true : undefined,
    );

    const hook = options!.hooks!.PreToolUse![0].hooks[0];

    const decision = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "pwd" },
        session_id: "x",
        transcript_path: "x",
        cwd: workspace,
        tool_use_id: "x",
      },
      "x",
      { signal: c.signal },
    );

    assert.equal(
      (decision as any).hookSpecificOutput?.permissionDecision,
      mode === "plan" ? "deny" : undefined,
    );

    const outside = await hook(
      {
        hook_event_name: "PreToolUse",
        tool_name: "Write",
        tool_input: { file_path: join(tmpdir(), "forbidden") },
        session_id: "x",
        transcript_path: "x",
        cwd: workspace,
        tool_use_id: "x",
      },
      "x",
      { signal: c.signal },
    );

    assert.equal(
      (outside as any).hookSpecificOutput?.permissionDecision,
      "deny",
    );
  }

  setClaudeOptions(c.task, { permission_mode: "inherit" });
  await provider.run(c, "Implement");
  assert.equal(Object.hasOwn(options!, "permissionMode"), false);
  c.task.worker_profile = "reviewer";
  setClaudeOptions(c.task, { permission_mode: "bypassPermissions" });
  await provider.run(c, "Review");

  assert.ok(
    options!.tools instanceof Array &&
      !options!.tools.includes("Write") &&
      !options!.tools.includes("Bash"),
  );

  assert.equal(
    (await options!.canUseTool!(
      "Write",
      { file_path: "a.ts" },
      { signal: c.signal, toolUseID: "write", requestId: "request" },
    ))!.behavior,
    "deny",
  );
});

test("unresolved SDK edits ask the configured decision maker and preserve the original input", async () => {
  const { c } = await context();
  c.task.worker_profile = "implementer";

  setClaudeOptions(c.task, {
    claude_policy: resolveClaudePolicy(claudeOverrideDefaults, "implementer"),
  });

  setClaudeOptions(c.task, { permission_mode: "default" });
  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    (args) => {
      options = args.options;

      return Object.assign(
        (async function* () {
          yield {
            type: "result",
            subtype: "success",
            result: reply,
            total_cost_usd: 0,
            usage: {},
          };
        })(),
        { close: () => {} },
      ) as unknown as Query;
    },
    undefined,
    readyClaudeCli,
  );

  await provider.run(c, "Implement");

  for (const tool of ["Edit", "Write"]) {
    const input = { file_path: "a.ts", content: "approved contents" };

    assert.equal(
      (await options!.canUseTool!(tool, input, {
        signal: c.signal,
        toolUseID: "edit",
        requestId: "request",
      }))!.behavior,
      "deny",
    );

    let requested: unknown;

    c.input = async (name, payload) => {
      requested = { name, payload };

      return {
        approved: true,
        input: { file_path: "/tmp/another-file", content: "substitution" },
      };
    };

    const allowed = await options!.canUseTool!(tool, input, {
      signal: c.signal,
      toolUseID: "edit",
      requestId: "request",
    });

    assert.deepEqual(requested, { name: tool, payload: input });
    assert.equal(allowed!.behavior, "allow");
    assert.deepEqual((allowed as any).updatedInput, input);
    c.input = async () => ({ approved: false });
  }
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
    undefined,
    readyClaudeCli,
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

  const provider = new ClaudeAgentProvider(
    (args) => {
      options = args.options;

      const messages = (async function* () {
        yield {
          type: "result",
          subtype: "success",
          is_error: false,
          session_id: "existing-session",
          result: reply,
          total_cost_usd: 0.1,
          usage: {},
        };
      })();

      return Object.assign(messages, { close: () => {} }) as unknown as Query;
    },
    undefined,
    readyClaudeCli,
  );

  assert.deepEqual(await provider.run(c, "Review"), { reply });
  assert.equal(Object.hasOwn(options!, "maxBudgetUsd"), false);
});

test("filtered Claude environment excludes service and other-provider credentials at the real SDK spawn boundary", async () => {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const env = claudeEnvironment(
    {
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
    },
    "filtered",
  );

  assert.deepEqual(Object.keys(env).sort(), [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CONFIG_DIR",
    "HOME",
    "PATH",
  ]);

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
        // Drain the stream.
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

test("Claude asks for a plain reply, with no structured output tool", async () => {
  const { c } = await context();
  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    (args) => {
      options = args.options;

      return Object.assign(
        (async function* () {
          yield {
            type: "result",
            subtype: "success",
            result: "Reviewed **a.ts**; one check is missing.",
            total_cost_usd: 0,
            usage: {},
          };
        })(),
        { close: () => {} },
      ) as unknown as Query;
    },
    undefined,
    readyClaudeCli,
  );

  assert.deepEqual(await provider.run(c, "Report"), {
    reply: "Reviewed **a.ts**; one check is missing.",
  });

  assert.equal(options!.outputFormat, undefined);

  assert.match(
    (options!.systemPrompt as { append: string }).append,
    /End each turn with a plain reply/,
  );

  const permission = (name: string, input: object) =>
    options!.canUseTool!(name, input as Record<string, unknown>, {
      signal: c.signal,
      toolUseID: "x",
      requestId: "request",
    });

  for (const tool of ["StructuredOutput", "mcp__unconfigured__report"])
    assert.equal(
      (await permission(tool, { summary: "Report" }))!.behavior,
      "deny",
    );
});

async function runWithPolicy(
  policy: ClaudePolicy,
  worker_profile: Task["worker_profile"] = "implementer",
) {
  const ctx = await context();
  ctx.c.task.worker_profile = worker_profile;
  setClaudeOptions(ctx.c.task, { permission_mode: "default" });
  setClaudeOptions(ctx.c.task, { claude_policy: policy });
  const asked: string[] = [];

  ctx.c.input = async (tool) => {
    asked.push(tool);

    return { approved: true };
  };

  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    (args) => {
      options = args.options;

      return Object.assign(
        (async function* () {
          yield {
            type: "result",
            subtype: "success",
            result: reply,
            total_cost_usd: 0,
            usage: {},
          };
        })(),
        { close: () => {} },
      ) as unknown as Query;
    },
    undefined,
    readyClaudeCli,
  );

  await provider.run(ctx.c, "Work");
  const hook = options!.hooks!.PreToolUse![0].hooks[0];

  const check = async (tool: string, input: object) =>
    (
      (await hook(
        {
          hook_event_name: "PreToolUse",
          tool_name: tool,
          tool_input: input,
          session_id: "x",
          transcript_path: "x",
          cwd: ctx.workspace,
          tool_use_id: "x",
        },
        "x",
        { signal: ctx.c.signal },
      )) as any
    ).hookSpecificOutput?.permissionDecision;

  const decide = async (tool: string, input: Record<string, unknown>) =>
    (await options!.canUseTool!(tool, input, {
      signal: ctx.c.signal,
      toolUseID: "x",
      requestId: "request",
    }))!.behavior;

  return { ...ctx, options: options!, check, decide, asked };
}

const parity = {
  sandbox: "user_config",
  environment: "inherit",
  tools: "all",
  path_guard: false,
  subagents: true,
} as const;

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
  ])
    assert.equal(options.env![name], undefined, name);

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

test("Claude tasks with resolved default restrictions run with CLI parity", async () => {
  const { c } = await context();
  c.task.worker_profile = "implementer";

  setClaudeOptions(c.task, {
    claude_policy: resolveClaudePolicy(claudeOverrideDefaults, "implementer"),
  });

  setClaudeOptions(c.task, { permission_mode: "inherit" });
  let options: Options | undefined;

  await new ClaudeAgentProvider(
    (args) => {
      options = args.options;

      return Object.assign(
        (async function* () {
          yield {
            type: "result",
            subtype: "success",
            result: reply,
            total_cost_usd: 0,
            usage: {},
          };
        })(),
        { close: () => {} },
      ) as unknown as Query;
    },
    undefined,
    readyClaudeCli,
  ).run(c, "Implement");

  assert.equal(options!.sandbox, undefined);
  assert.equal(options!.pathToClaudeCodeExecutable, fakeClaudePath);
  assert.equal(Object.hasOwn(options!, "permissionMode"), false);
  assert.deepEqual(options!.settingSources, ["user", "project", "local"]);
  assert.deepEqual(options!.tools, { type: "preset", preset: "claude_code" });
  assert.deepEqual(options!.disallowedTools, []);
  assert.equal(options!.env!.PATH, process.env.PATH);
  assert.equal(new ClaudeAgentProvider().capabilities.subagents, true);
});

test("Claude rejects unresolved native task state before launching a harness", async () => {
  const { c } = await context();
  let launched = false;

  const provider = new ClaudeAgentProvider(
    () => {
      launched = true;
      throw new Error("Harness should not launch");
    },
    undefined,
    readyClaudeCli,
  );

  for (const field of [
    "claude_policy",
    "permission_mode",
    "approval_decider",
  ] as const) {
    const options = { ...claudeOptions(c.task) };
    delete options[field];

    const task = {
      ...c.task,
      provider_options: { ...c.task.provider_options, claude: options },
    };

    await assert.rejects(
      provider.run({ ...c, task }, "Review"),
      /Claude task is missing resolved native permission state/,
    );

    assert.equal(launched, false);
  }
});

test("an unsupported Claude CLI fails the turn and model discovery without launching", async () => {
  const { c } = await context();

  setClaudeOptions(c.task, {
    claude_policy: resolveClaudePolicy(claudeOverrideDefaults, "implementer"),
  });

  const message = "Claude Code 2.0.0 at /bin/claude is older than supported.";
  let launches = 0;

  const provider = new ClaudeAgentProvider(
    () => {
      launches++;

      return {} as Query;
    },
    undefined,
    {
      status: async () => ({
        ready: false,
        problem: "too_old",
        message,
        path: "/bin/claude",
        version: "2.0.0",
        supported: "2.1.285–2.1.295",
      }),
      executable: async () => {
        throw new Error(message);
      },
    },
  );

  assert.deepEqual(await provider.readiness(), {
    ready: false,
    message,
    details: {
      executable: "/bin/claude",
      version: "2.0.0",
      supported_versions: "2.1.285–2.1.295",
    },
  });

  await assert.rejects(provider.run(c, "Implement"), { message });
  await assert.rejects(provider.models(), { message });
  assert.equal(launches, 0);
});
