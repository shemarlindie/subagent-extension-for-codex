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

test("Claude SDK query uses native harness, resume, a plain reply, remaining budget and the task's mode", async () => {
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

  assert.deepEqual(options!.settingSources, ["user", "project", "local"]);
  assert.equal(options!.strictMcpConfig, undefined);
  assert.equal(options!.mcpServers, undefined);

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

test("The Claude Agent SDK starts Claude Code without private variables", async () => {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");

  const env = claudeEnvironment({
    PATH: process.env.PATH,
    USER_TOOLCHAIN_HOME: "/synthetic/toolchain",
    OPENAI_API_KEY: "synthetic-app-key",
    SUBAGENT_EXTENSION_FOR_CODEX_TOKEN: "synthetic-service-token",
  });

  assert.deepEqual(Object.keys(env).sort(), [
    "CLAUDE_CODE_STARTUP_FAILURE_RESULTS",
    "PATH",
    "USER_TOOLCHAIN_HOME",
  ]);

  let spawned: Record<string, string | undefined> | undefined;

  await assert.rejects(async () => {
    const stream = query({
      prompt: "Never executed",
      options: {
        env,
        spawnClaudeCodeProcess: (options) => {
          spawned = options.env;
          throw new Error("Synthetic spawn refusal");
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
  assert.equal(spawned.PATH, process.env.PATH);
  assert.equal(spawned.USER_TOOLCHAIN_HOME, "/synthetic/toolchain");

  for (const name of ["SUBAGENT_EXTENSION_FOR_CODEX_TOKEN", "OPENAI_API_KEY"]) {
    assert.equal(
      spawned[name],
      undefined,
      `${name} must not reach Claude Code`,
    );
  }
});

test("a refusal shows Claude Code's own text, and result failures retain codes and diagnostics", async () => {
  const run = async (result: Record<string, unknown>) => {
    const { c } = await context();
    setClaudeOptions(c.task, { permission_mode: "default" });

    const launch = () =>
      Object.assign(
        (async function* () {
          yield {
            type: "result",
            is_error: true,
            subtype: "error_during_execution",
            usage: {},
            errors: ["Sign in with your organization."],
            ...result,
          };
        })(),
        { close: () => {} },
      );

    return new ClaudeAgentProvider(
      launch as unknown as ConstructorParameters<typeof ClaudeAgentProvider>[0],
      undefined,
      readyClaudeCli,
    ).run(c, "Work");
  };

  await assert.rejects(
    run({ startup_failure_reason: "org_pin_api_key_conflict" }),
    { message: "Sign in with your organization." },
  );

  await assert.rejects(run({}), {
    code: "error_during_execution",
    message: "Sign in with your organization.",
  });

  await assert.rejects(run({ subtype: "error_max_budget_usd", errors: [] }), {
    code: "cost_budget_exhausted",
    message: "",
  });
});

test("Claude asks for a plain reply before the custom instructions, with no structured output tool", async () => {
  const { c } = await context();
  c.task.profile_instructions = "Cite file paths.";
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
    /End each turn with a plain reply[\s\S]*custom instructions for the reviewer profile:\nCite file paths\.$/,
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
    claude_policy: resolveClaudePolicy(claudeOverrideDefaults),
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
        supported: "2.1.300+",
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
      problem: "too_old",
      executable: "/bin/claude",
      version: "2.0.0",
      supported_versions: "2.1.300+",
    },
  });

  await assert.rejects(provider.run(c, "Implement"), { message });
  await assert.rejects(provider.models(), { message });
  assert.equal(launches, 0);
});

test("a turn interrupted before its prompt sends nothing and holds the prompt", async () => {
  const { c } = await context();
  const controller = new AbortController();
  const sent: unknown[] = [];
  let held = 0;
  c.signal = controller.signal;

  c.promptHeld = () => {
    held += 1;
  };

  const provider = new ClaudeAgentProvider(
    (args) => {
      controller.abort();

      // Ends once the input does, without a result.
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            for await (const message of args.prompt as AsyncIterable<unknown>) {
              sent.push(message);
            }

            return { done: true, value: undefined };
          },
        }),
        close: () => {},
        interrupt: async () => {},
      } as unknown as Query;
    },
    undefined,
    readyClaudeCli,
  );

  await assert.rejects(provider.run(c, "Implement"), /without a result/);
  assert.deepEqual(sent, []);
  assert.equal(held, 1);
});
