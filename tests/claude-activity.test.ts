import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeAgentProvider } from "../src/providers/claude.js";
import { startSchema, type RunContext, type Task } from "../src/model.js";

function recorder() {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const context = {
    emit: (type: string, data: Record<string, unknown>) =>
      events.push({ type, data }),
  } as RunContext;
  const normalize = (message: Record<string, unknown>) => {
    new ClaudeAgentProvider().normalize(context, message as SDKMessage);
    return events;
  };
  return { events, context, normalize };
}

const systemSubtypes = [
  "status",
  "api_retry",
  "compact_boundary",
  "local_command_output",
  "hook_started",
  "hook_progress",
  "hook_response",
  "plugin_install",
  "task_notification",
  "task_started",
  "task_updated",
  "task_progress",
  "session_state_changed",
  "notification",
  "files_persisted",
  "memory_recall",
  "elicitation_complete",
  "permission_denied",
  "mirror_error",
  "future_subtype",
];
for (const subtype of systemSubtypes) {
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
for (const type of [
  "stream_event",
  "tool_progress",
  "tool_use_summary",
  "auth_status",
  "rate_limit_event",
  "prompt_suggestion",
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

for (const subtype of [
  "success",
  "error_max_turns",
  "error_during_execution",
  "error_max_budget_usd",
  "error_max_structured_output_retries",
]) {
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
  t.after(() => rm(workspace, { recursive: true, force: true }));
  for (const failed of [false, true]) {
    const { events, context } = recorder();
    context.task = {
      ...startSchema.parse({ task: "Review", worker_profile: "reviewer" }),
      repository: workspace,
      workspace,
      id: "task",
      owner: "owner",
      status: "running",
      created_at: "",
      updated_at: "",
      instructions: [],
      attempt: 1,
      runtime_ms: 0,
    } as Task;
    context.signal = new AbortController().signal;
    context.session = () => {};
    context.input = async () => ({ approved: false });
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
    );
    if (failed)
      await assert.rejects(provider.run(context, "Review"), /error_max_turns/);
    else
      assert.equal((await provider.run(context, "Review")).summary, "Finished");
    const completed = events.filter(
      (event) => event.type === "agent.completed",
    );
    assert.equal(completed.length, 1);
    assert.equal(completed[0].data.cost_usd, 0.25);
    assert.deepEqual(completed[0].data.raw_response, message);
  }
});
