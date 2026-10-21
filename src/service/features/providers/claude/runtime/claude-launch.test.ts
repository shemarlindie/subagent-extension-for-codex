import assert from "node:assert/strict";

import { type Options, type Query } from "@anthropic-ai/claude-agent-sdk";
import { test } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import {
  claudeOverrideDefaults,
  resolveClaudePolicy,
} from "../../../../../shared/providers/claude/permissions.js";
import { claudeEnvironment } from "../configuration/execution-environment.js";
import {
  captureOptions,
  claudeOptions,
  context,
  reply,
  setClaudeOptions,
} from "./claude-test-harness.js";
import { ClaudeAgentProvider } from "./provider.js";

test("Claude SDK query uses native harness, resume, a plain reply, remaining budget and profile restrictions", async () => {
  const { c, events, sessions } = await context();
  c.task.budget.max_cost_usd = 5;
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
  const parentServer = options!.mcpServers?.codex_parent;
  assert.ok(parentServer);
  assert.equal(parentServer.type, "sdk");

  assert.equal(options!.allowedTools, undefined);

  assert.ok(!options!.disallowedTools!.includes("Skill"));
  assert.equal(options!.permissionMode, "plan");
  assert.equal(options!.allowDangerouslySkipPermissions, undefined);
  assert.ok(sessions.length);
  assert.ok(events.find((e) => e.type === "tool.started"));
  assert.ok(closed);
});

test("Claude forwards the selected model and effort without changing its resolved permission mode", async () => {
  const { c } = await context();
  let options: Options | undefined;

  const provider = new ClaudeAgentProvider(
    captureOptions((value) => {
      options = value;
    }),
    undefined,
    readyClaudeCli,
  );

  c.task.model = "selected-model";
  c.task.reasoning_effort = "high";
  await provider.run(c, "Review");
  assert.equal(options!.model, "selected-model");
  assert.equal(options!.effort, "high");
  assert.equal(options!.permissionMode, "plan");
  delete c.task.model;
  c.task.reasoning_effort = "default";
  await provider.run(c, "Review");
  assert.equal(Object.hasOwn(options!, "model"), false);
  assert.equal(Object.hasOwn(options!, "effort"), false);
  delete c.task.reasoning_effort;
  await provider.run(c, "Review");
  assert.equal(Object.hasOwn(options!, "effort"), false);
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
  ]) {
    assert.equal(
      spawned[name],
      undefined,
      `${name} must not reach the native harness`,
    );
  }
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

  for (const tool of ["StructuredOutput", "mcp__unconfigured__report"]) {
    assert.equal(
      (await permission(tool, { summary: "Report" }))!.behavior,
      "deny",
    );
  }
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
      new RegExp(field),
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
        supported: "2.1.285+",
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
      supported_versions: "2.1.285+",
    },
  });

  await assert.rejects(provider.run(c, "Implement"), { message });
  await assert.rejects(provider.models(), { message });
  assert.equal(launches, 0);
});
