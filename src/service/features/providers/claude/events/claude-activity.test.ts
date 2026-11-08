import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  Query,
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { test } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import { decodedEvent } from "../../../../../shared/events/decode.js";
import { groupActivity } from "../../../../../shared/tasks/activity/activity-timeline.js";
import { startSchema } from "../../../../../shared/tasks/model.js";
import { type RunContext } from "../../types.js";
import { ClaudeAgentProvider } from "../runtime/provider.js";
import { claudeActivityPresentation } from "./activity.js";
import { claudeMessageNormalizer, fileContentOmitted } from "./normalize.js";

function recorder() {
  const events: { type: string; data: Record<string, unknown> }[] = [];

  const context = {
    emit: (type: string, data: Record<string, unknown>) => {
      const { activity: _, ...payload } = data;
      events.push({ type, data: payload });
    },
    emitOpaque: (type: string, data: Record<string, unknown>) => {
      const { activity: _, ...payload } = data;
      events.push({ type, data: payload });
    },
  } as unknown as RunContext;

  const normalizeMessage = claudeMessageNormalizer();

  const normalize = (message: SDKMessage) => {
    normalizeMessage(context, message);

    return events;
  };

  const normalizeUnrecognized = (message: Record<string, unknown>) => {
    // Deliberately malformed runtime fixture: exercise preservation of a value
    // that the installed SDK's static union cannot express.
    normalizeMessage(context, message as unknown as SDKMessage);

    return events;
  };

  return { events, context, normalize, normalizeUnrecognized };
}

function assistantMessage(
  content: SDKAssistantMessage["message"]["content"],
  messageId = "sdk-message",
  overrides: Partial<SDKAssistantMessage> = {},
): SDKAssistantMessage {
  return {
    type: "assistant",
    uuid: "00000000-0000-4000-8000-000000000001",
    session_id: "sdk-session",
    parent_tool_use_id: null,
    message: {
      id: messageId,
      container: null,
      context_management: null,
      type: "message",
      role: "assistant",
      model: "claude-test",
      content,
      stop_details: null,
      stop_reason: null,
      stop_sequence: null,
      usage: testUsage(),
    },
    ...overrides,
  };
}

function testUsage() {
  return {
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    inference_geo: "global",
    input_tokens: 0,
    iterations: [],
    output_tokens: 0,
    server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
    service_tier: "standard" as const,
    speed: "standard" as const,
  };
}

function userMessage(
  content: SDKUserMessage["message"]["content"],
  overrides: Partial<SDKUserMessage> = {},
): SDKUserMessage {
  return {
    type: "user",
    uuid: "00000000-0000-4000-8000-000000000002",
    session_id: "sdk-session",
    parent_tool_use_id: null,
    message: { role: "user", content },
    ...overrides,
  };
}

function resultMessage(
  subtype: "success",
): Extract<SDKResultMessage, { subtype: "success" }>;
function resultMessage(
  subtype: Exclude<SDKResultMessage["subtype"], "success">,
): Extract<
  SDKResultMessage,
  { subtype: Exclude<SDKResultMessage["subtype"], "success"> }
>;
function resultMessage(subtype: SDKResultMessage["subtype"]): SDKResultMessage;

function resultMessage(subtype: SDKResultMessage["subtype"]): SDKResultMessage {
  const failed = subtype !== "success";

  const common = {
    type: "result" as const,
    duration_ms: 0,
    duration_api_ms: 0,
    is_error: failed,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    usage: testUsage(),
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-4000-8000-000000000003" as const,
    session_id: "sdk-session",
  };

  if (subtype === "success") {
    return { ...common, subtype, result: "Finished" };
  }

  return { ...common, subtype, errors: [] };
}

test("Claude stream presentation narrows current SDK delta variants", () => {
  const message = {
    type: "stream_event",
    event: {
      type: "content_block_delta",
      index: 2,
      delta: { type: "text_delta", text: "Streamed text" },
    },
    parent_tool_use_id: null,
    uuid: "00000000-0000-4000-8000-000000000008",
    session_id: "sdk-session",
  } satisfies Extract<SDKMessage, { type: "stream_event" }>;

  const presentation = claudeActivityPresentation({
    type: "claude.activity",
    data: message,
    rawResponse: message,
  });

  assert.deepEqual(presentation.stream?.update, {
    index: 2,
    append: { field: "text", type: "text", text: "Streamed text" },
  });

  assert.deepEqual(presentation.stream?.content, {
    type: "opaque",
    data: { type: "text_delta", text: "Streamed text" },
  });
});

test("Claude rate-limit activity uses the current typed SDK metadata", () => {
  const message = {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed_warning",
      rateLimitType: "five_hour",
      utilization: 0.75,
      resetsAt: 100,
    },
    uuid: "00000000-0000-4000-8000-000000000009",
    session_id: "sdk-session",
  } satisfies Extract<SDKMessage, { type: "rate_limit_event" }>;

  const presentation = claudeActivityPresentation({
    type: "claude.activity",
    data: message,
    rawResponse: message,
  });

  assert.deepEqual(presentation.rateLimitWindows, [
    {
      id: "five_hour",
      label: "5-hour window",
      utilization: 0.75,
      resetsAt: 100,
    },
  ]);
});

test("Claude preserves the activity kind and normalized fields of an unknown message", () => {
  const message = {
    type: "future_sdk_message",
    event: { type: "future_delta", value: 0 },
    enabled: false,
  };

  assert.deepEqual(recorder().normalizeUnrecognized(message), [
    {
      type: "claude.activity",
      data: { type: message.type, event: message.event },
    },
  ]);
});

test("Activity reads a summary from the payload when the presentation would repeat it", () => {
  const data: Record<string, unknown>[] = [];

  claudeMessageNormalizer()(
    {
      emitOpaque: (_: string, d: Record<string, unknown>) => data.push(d),
    } as unknown as RunContext,
    {
      type: "tool_use_summary",
      summary: "Read 2 files",
      preceding_tool_use_ids: [],
      uuid: "00000000-0000-4000-8000-000000000008",
      session_id: "sdk-session",
    },
  );

  const [event] = data.map((d, id) =>
    decodedEvent({
      id,
      task_id: "task",
      type: "claude.activity",
      timestamp: "",
      data: d,
    }),
  );

  assert.ok(event);
  assert.equal(event.presentation?.summary, undefined);
  assert.equal(groupActivity([event])[0]?.summary, "Read 2 files");
});

test("Claude preserves familiar event contracts and their normalized fields", () => {
  const { events, normalize } = recorder();

  const init = {
    type: "system",
    subtype: "init",
    apiKeySource: "none",
    claude_code_version: "1.0.0",
    cwd: "/repo",
    mcp_servers: [],
    model: "model",
    tools: ["Read"],
    permissionMode: "default",
    slash_commands: [],
    output_style: "default",
    skills: [],
    plugins: [{ name: "plugin", path: "/plugin" }],
    uuid: "00000000-0000-4000-8000-000000000005",
    session_id: "sdk-session",
  } satisfies Extract<SDKMessage, { type: "system"; subtype: "init" }>;

  const assistant = assistantMessage(
    [
      { type: "text", text: "Checking", citations: null },
      {
        type: "tool_use",
        id: "tool",
        name: "Grep",
        input: { pattern: "a", head_limit: 0, multiline: false },
      },
    ],
    "message",
    { uuid: "00000000-0000-4000-8000-000000000006" },
  );

  const user = userMessage(
    [
      {
        type: "tool_result",
        tool_use_id: "tool",
        is_error: false,
        content: [{ type: "text", text: "file output" }],
      },
    ],
    {
      uuid: "00000000-0000-4000-8000-000000000007",
      tool_use_result: { duration: 0 },
    },
  );

  normalize(init);
  normalize(assistant);
  normalize(user);

  assert.deepEqual(events, [
    {
      type: "agent.started",
      data: { model: init.model, tools: init.tools },
    },
    {
      type: "agent.message",
      data: {
        role: "assistant",
        message_id: assistant.message.id,
        parent_tool_use_id: assistant.parent_tool_use_id,
        text: "Checking",
      },
    },
    {
      type: "tool.started",
      data: {
        id: "tool",
        name: "Grep",
        input: { pattern: "a", head_limit: 0, multiline: false },
      },
    },
    {
      type: "tool.completed",
      data: {
        id: "tool",
        error: false,
        content: [{ type: "text", text: "file output" }],
      },
    },
  ]);
});

test("file tool events keep paths and errors without file contents outside full events", () => {
  const calls = assistantMessage([
    {
      type: "tool_use",
      id: "read",
      name: "Read",
      input: { file_path: "a.ts", offset: 2 },
    },
    {
      type: "tool_use",
      id: "edit",
      name: "Edit",
      input: { file_path: "a.ts", old_string: "a", new_string: "b" },
    },
    {
      type: "tool_use",
      id: "notebook",
      name: "NotebookEdit",
      input: { notebook_path: "a.ipynb", new_source: "x = 1" },
    },
  ]);

  const results = userMessage([
    { type: "tool_result", tool_use_id: "read", content: "1\tconst a" },
    {
      type: "tool_result",
      tool_use_id: "edit",
      is_error: true,
      content: "String not found",
    },
    { type: "tool_result", tool_use_id: "notebook", content: "Updated" },
  ]);

  const stored = (fullEvents: boolean) => {
    const { context, events } = recorder();
    const normalize = claudeMessageNormalizer(fullEvents);
    normalize(context, calls);
    normalize(context, results);

    return events.map((event) =>
      event.type === "tool.started" ? event.data.input : event.data.content,
    );
  };

  assert.deepEqual(stored(false), [
    { file_path: "a.ts", offset: 2 },
    { file_path: "a.ts" },
    { notebook_path: "a.ipynb" },
    fileContentOmitted,
    "String not found",
    fileContentOmitted,
  ]);

  assert.deepEqual(stored(true), [
    { file_path: "a.ts", offset: 2 },
    { file_path: "a.ts", old_string: "a", new_string: "b" },
    { notebook_path: "a.ipynb", new_source: "x = 1" },
    "1\tconst a",
    "String not found",
    "Updated",
  ]);
});

test("assistant thinking blocks retain their typed content and source message", () => {
  const message = assistantMessage([
    { type: "text", text: "Visible text", citations: null },
    { type: "thinking", thinking: "Reasoning text", signature: "opaque" },
    { type: "redacted_thinking", data: "redacted" },
  ]);

  const events = recorder().normalize(message);
  const [first, ...blocks] = events;
  assert.equal(events.length, 3);
  assert.ok(first);
  assert.equal(first.data.text, "Visible text");

  assert.deepEqual(
    blocks.map((event) => [event.type, event.data.content, event.data.role]),
    [
      [
        "agent.content",
        { type: "thinking", thinking: "Reasoning text" },
        "assistant",
      ],
      [
        "agent.content",
        {
          type: "opaque",
          data: { type: "redacted_thinking", data: "redacted" },
        },
        "assistant",
      ],
    ],
  );

  for (const event of events) {
    assert.equal(event.data.raw_response, undefined);
    assert.equal(event.data.response_ref, undefined);
  }
});

test("user image, document and tool-result blocks stay inspectable in order", () => {
  const content: Exclude<SDKUserMessage["message"]["content"], string> = [
    { type: "text", text: "Visible text" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "payload",
      },
    },
    {
      type: "document",
      citations: null,
      source: {
        type: "text",
        media_type: "text/plain",
        data: "document content",
      },
      title: null,
    },
    {
      type: "tool_result",
      tool_use_id: "tool",
      is_error: false,
      content: [{ type: "text", text: "file output" }],
    },
  ];

  const message = userMessage(content);
  const events = recorder().normalize(message);

  const [first] = events;
  assert.equal(events.length, content.length);
  assert.ok(first);
  assert.equal(first.type, "agent.content");
  assert.equal(first.data.text, "Visible text");

  assert.deepEqual(
    events.slice(1, -1).map((event) => [event.type, event.data.content]),
    [
      ["agent.content", { type: "opaque", data: content[1] }],
      ["agent.content", { type: "opaque", data: content[2] }],
    ],
  );

  assert.equal(events.at(-1)?.type, "tool.completed");

  assert.deepEqual(events.at(-1)?.data.content, [
    { type: "text", text: "file output" },
  ]);

  assert.ok(
    events.every(
      (event) =>
        event.data.raw_response === undefined &&
        event.data.response_ref === undefined,
    ),
  );
});

test("unrecognized content remains opaque through the runtime fallback", () => {
  const content = { type: "future_block", value: { enabled: false, count: 0 } };

  const message = {
    type: "assistant",
    message: { content: [content] },
    parent_tool_use_id: null,
  };

  const [event] = recorder().normalizeUnrecognized(message);
  assert.ok(event);

  assert.deepEqual(event.data.content, {
    type: "opaque",
    data: content,
  });
});

test("empty or error assistant messages and user string messages remain inspectable", () => {
  const cases: { message: SDKMessage; text?: string }[] = [
    { message: assistantMessage([], "sdk-message", { error: "rate_limit" }) },
    { message: assistantMessage([]) },
    { message: userMessage("User instruction"), text: "User instruction" },
    { message: userMessage("") },
  ];

  for (const { message, text } of cases) {
    const events = recorder().normalize(message);
    const [first] = events;
    assert.ok(first, JSON.stringify(message));

    for (const event of events) {
      assert.equal(event.data.raw_response, undefined);
      assert.equal(event.data.response_ref, undefined);
    }

    if (text !== undefined) {
      assert.equal(first.data.text, text);
    }

    if ("error" in message) {
      assert.equal(first.data.error, message.error);
    }
  }
});

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
          permission_source: "task",
          claude_policy: {
            sandbox: false,
            subagents: true,
            settings_files: true,
            user_mcp: true,
          },
        },
      },
      title: "Review",
    };

    context.signal = new AbortController().signal;
    context.session = () => {};
    context.input = async () => ({ approved: false });
    context.acceptSteers = () => {};
    context.steerTaken = () => {};
    context.delta = () => {};

    const message = failed
      ? {
          ...resultMessage("error_max_turns"),
          errors: ["Stopped"],
          total_cost_usd: 0.25,
        }
      : {
          ...resultMessage("success"),
          result: "Finished",
          total_cost_usd: 0.25,
        };

    const provider = new ClaudeAgentProvider(
      () =>
        Object.assign(
          (async function* () {
            yield message;
          })(),
          { close() {} },
        ) as unknown as Query,
      readyClaudeCli,
    );

    if (failed) {
      await assert.rejects(provider.run(context, "Review"), {
        code: "error_max_turns",
        message: "Stopped",
      });
    } else {
      assert.equal((await provider.run(context, "Review")).reply, "Finished");
    }

    const completed = events.filter(
      (event) => event.type === "agent.completed",
    );

    const [done] = completed;
    assert.equal(completed.length, 1);
    assert.ok(done);
    assert.equal(done.data.cost_usd, 0.25);
    assert.equal(done.data.raw_response, undefined);
    // The service records a successful result as the turn's reply.
    if (!failed) assert.equal(done.data.result, undefined);
  }
});

test("full-event mode retains exact unknown and error originals without copying native fields into activity", () => {
  for (const message of [
    { type: "future_sdk_message", unique: { signature: "opaque" } },
    assistantMessage([], "shared", { error: "rate_limit" }),
  ]) {
    const { context, events } = recorder();
    claudeMessageNormalizer(true)(context, message as SDKMessage);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.data.raw_response, message);
    assert.equal(typeof events[0]?.data.response_ref, "string");
    assert.equal(events[0]?.data.message, undefined);
    assert.equal(events[0]?.data.unique, undefined);
  }
});
