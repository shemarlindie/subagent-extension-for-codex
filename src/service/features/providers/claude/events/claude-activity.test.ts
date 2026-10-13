import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  Query,
  SDKAssistantMessageError,
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { test } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import { startSchema, type Task } from "../../../../../shared/tasks/model.js";
import { type RunContext } from "../../types.js";
import { ClaudeAgentProvider } from "../runtime/provider.js";

function recorder() {
  const events: { type: string; data: Record<string, unknown> }[] = [];

  const context = {
    emit: (type: string, data: Record<string, unknown>) => {
      const { activity: _, ...payload } = data;
      events.push({ type, data: payload });
    },
  } as unknown as RunContext;

  const normalize = (message: Record<string, unknown>) => {
    new ClaudeAgentProvider().normalize(context, message as SDKMessage);

    return events;
  };

  return { events, context, normalize };
}

type SdkSystemSubtype = Exclude<
  Extract<SDKMessage, { type: "system" }>["subtype"],
  "init"
>;

const systemSubtypes: Record<SdkSystemSubtype, true> = {
  status: true,
  api_retry: true,
  compact_boundary: true,
  control_request_progress: true,
  model_refusal_fallback: true,
  model_refusal_no_fallback: true,
  local_command_output: true,
  hook_started: true,
  hook_progress: true,
  hook_response: true,
  plugin_install: true,
  task_notification: true,
  task_started: true,
  task_updated: true,
  task_progress: true,
  background_tasks_changed: true,
  thinking_tokens: true,
  session_state_changed: true,
  worker_shutting_down: true,
  commands_changed: true,
  notification: true,
  files_persisted: true,
  memory_recall: true,
  elicitation_complete: true,
  permission_denied: true,
  mirror_error: true,
  informational: true,
};

for (const subtype of [...Object.keys(systemSubtypes), "future_subtype"]) {
  test(`Claude preserves system ${subtype} as inspectable activity`, () => {
    const message = {
      type: "system",
      subtype,
      uuid: "sdk-uuid",
      session_id: "sdk-session",
      extra: { nested: [0, false, null, "retained"] },
    };

    const { normalize } = recorder();

    assert.deepEqual(normalize(message), [
      { type: "claude.activity", data: { ...message, raw_response: message } },
    ]);
  });
}

type SdkTopLevelActivity = Exclude<
  SDKMessage["type"],
  "assistant" | "user" | "result" | "system"
>;

const topLevelActivityTypes: Record<SdkTopLevelActivity, true> = {
  stream_event: true,
  tool_progress: true,
  tool_use_summary: true,
  auth_status: true,
  rate_limit_event: true,
  prompt_suggestion: true,
  conversation_reset: true,
};

for (const type of [
  ...Object.keys(topLevelActivityTypes),
  "future_sdk_message",
]) {
  test(`Claude preserves ${type} and unknown fields`, () => {
    const message = {
      type,
      event: { type: "future_delta", value: 0 },
      enabled: false,
    };

    assert.deepEqual(recorder().normalize(message), [
      { type: "claude.activity", data: { ...message, raw_response: message } },
    ]);
  });
}

test("Claude preserves familiar event contracts and their full SDK envelope", () => {
  const { events, normalize } = recorder();

  const init = {
    type: "system",
    subtype: "init",
    model: "model",
    tools: ["Read"],
    plugins: [{ name: "plugin", path: "/plugin" }],
  };

  const assistant = {
    type: "assistant",
    uuid: "a",
    message: {
      id: "message",
      content: [
        { type: "text", text: "Checking" },
        {
          type: "tool_use",
          id: "tool",
          name: "Read",
          input: { file_path: "a.ts", count: 0, enabled: false },
        },
      ],
    },
  };

  const user = {
    type: "user",
    uuid: "u",
    tool_use_result: { duration: 0 },
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool",
          is_error: false,
          content: [{ type: "text", text: "file output" }],
        },
      ],
    },
  };

  normalize(init);
  normalize(assistant);
  normalize(user);

  assert.deepEqual(events, [
    {
      type: "agent.started",
      data: { model: init.model, tools: init.tools, raw_response: init },
    },
    {
      type: "agent.message",
      data: {
        role: "assistant",
        text: "Checking",
        content: assistant.message.content[0],
        raw_response: assistant,
      },
    },
    {
      type: "tool.started",
      data: {
        id: "tool",
        name: "Read",
        input: assistant.message.content[1].input,
        raw_response: assistant,
      },
    },
    {
      type: "tool.completed",
      data: {
        id: "tool",
        error: false,
        content: user.message.content[0].content,
        raw_response: user,
      },
    },
  ]);
});

test("mixed message blocks keep text, thinking, images, documents and future content in order", () => {
  for (const role of ["assistant", "user"]) {
    const blocks = [
      { type: "text", text: "Visible text" },
      { type: "thinking", thinking: "Reasoning text", signature: "opaque" },
      { type: "redacted_thinking", data: "redacted" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "payload" },
      },
      { type: "document", source: { type: "text", data: "document content" } },
      { type: "future_block", value: { enabled: false, count: 0 } },
    ];

    const message = {
      type: role,
      message: { content: blocks },
      parent_tool_use_id: "parent",
    };

    const events = recorder().normalize(message);
    assert.equal(events.length, blocks.length);
    assert.equal(events[0].data.text, "Visible text");

    for (let i = 1; i < blocks.length; i++) {
      assert.equal(events[i].type, "agent.content");
      assert.deepEqual(events[i].data.content, blocks[i]);
      assert.equal(events[i].data.role, role);
    }

    for (const event of events)
      assert.deepEqual(event.data.raw_response, message);
  }
});

test("empty or error assistant messages and user string messages remain inspectable", () => {
  for (const message of [
    { type: "assistant", error: "rate_limit", message: { content: [] } },
    { type: "assistant", message: { content: [] } },
    { type: "user", message: { content: "User instruction" } },
    { type: "user", message: { content: "" } },
  ]) {
    const events = recorder().normalize(message);
    assert.ok(events.length > 0, JSON.stringify(message));
    for (const event of events)
      assert.deepEqual(event.data.raw_response, message);
    if (message.message.content === "User instruction")
      assert.equal(events[0].data.text, "User instruction");
  }
});

const assistantErrors: Record<SDKAssistantMessageError, true> = {
  authentication_failed: true,
  oauth_org_not_allowed: true,
  account_on_hold: true,
  verification_required: true,
  billing_error: true,
  rate_limit: true,
  overloaded: true,
  invalid_request: true,
  model_not_found: true,
  server_error: true,
  unknown: true,
  max_output_tokens: true,
  cloud_credential_error: true,
};

for (const error of Object.keys(assistantErrors)) {
  test(`Claude preserves assistant error ${error}`, () => {
    const message = {
      type: "assistant",
      error,
      message: { content: [] },
    };

    assert.deepEqual(recorder().normalize(message), [
      {
        type: "claude.activity",
        data: { ...message, raw_response: message },
      },
    ]);
  });
}

const resultSubtypes: Record<SDKResultMessage["subtype"], true> = {
  success: true,
  error_max_turns: true,
  error_during_execution: true,
  error_max_budget_usd: true,
  error_max_structured_output_retries: true,
};

for (const subtype of Object.keys(resultSubtypes)) {
  test(`Claude ${subtype} result retains accounting and full result`, () => {
    const message = {
      type: "result",
      subtype,
      total_cost_usd: 0,
      usage: { input_tokens: 0 },
      is_error: subtype !== "success",
      errors: [],
      modelUsage: {},
      duration_ms: 0,
    };

    assert.deepEqual(recorder().normalize(message), [
      {
        type: "agent.completed",
        data: { ...message, cost_usd: 0, raw_response: message },
      },
    ]);
  });
}

test("run emits result accounting exactly once for success and failure", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "claude-activity-"));
  execFileSync("git", ["init", "-q", workspace]);
  t.onTestFinished(() => rm(workspace, { recursive: true, force: true }));

  for (const failed of [false, true]) {
    const { events, context } = recorder();

    context.task = {
      ...startSchema.parse({
        repository: "/repo",
        description: "Review",
        worker_profile: "reviewer",
        provider_options: {
          claude: { permission_mode: "plan", approval_decider: "user" },
        },
      }),
      repository: workspace,
      workspace,
      id: "task",
      owner: "owner",
      status: "running",
      created_at: "",
      updated_at: "",
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
          claude_policy: {
            sandbox: "user_config",
            environment: "inherit",
            tools: "restricted",
            path_guard: true,
            subagents: true,
          },
        },
      },
      title: "Review",
    } as Task;

    context.signal = new AbortController().signal;
    context.session = () => {};
    context.input = async () => ({ approved: false });
    context.acceptSteers = () => {};
    context.steerTaken = () => {};
    context.delta = () => {};

    const message = {
      type: "result",
      subtype: failed ? "error_max_turns" : "success",
      is_error: failed,
      result: "Finished",
      errors: ["Stopped"],
      total_cost_usd: 0.25,
      usage: { output_tokens: 0 },
    };

    const provider = new ClaudeAgentProvider(
      () =>
        Object.assign(
          (async function* () {
            yield message;
          })(),
          { close() {} },
        ) as unknown as Query,
      undefined,
      readyClaudeCli,
    );

    if (failed)
      await assert.rejects(provider.run(context, "Review"), /error_max_turns/);
    else
      assert.equal((await provider.run(context, "Review")).reply, "Finished");

    const completed = events.filter(
      (event) => event.type === "agent.completed",
    );

    assert.equal(completed.length, 1);
    assert.equal(completed[0].data.cost_usd, 0.25);
    assert.deepEqual(completed[0].data.raw_response, message);
  }
});
