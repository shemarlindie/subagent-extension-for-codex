import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  Query,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKMessage,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { test } from "vitest";

import { readyClaudeCli } from "../../../../../../tests/support/claude-cli.js";
import { startSchema } from "../../../../../shared/tasks/model.js";
import { type RunContext } from "../../types.js";
import { ClaudeAgentProvider } from "../runtime/provider.js";
import { claudeActivityPresentation } from "./activity.js";
import { normalizeClaudeMessage } from "./normalize.js";

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

  const normalize = (message: SDKMessage) => {
    normalizeClaudeMessage(context, message);

    return events;
  };

  const normalizeUnrecognized = (message: Record<string, unknown>) => {
    // Deliberately malformed runtime fixture: exercise preservation of a value
    // that the installed SDK's static union cannot express.
    normalizeClaudeMessage(context, message as unknown as SDKMessage);

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

void systemSubtypes;

test("Claude preserves a valid status message and its complete SDK envelope", () => {
  const message = {
    type: "system",
    subtype: "status",
    status: "requesting",
    uuid: "00000000-0000-4000-8000-000000000004",
    session_id: "sdk-session",
  } satisfies Extract<SDKMessage, { type: "system"; subtype: "status" }>;

  assert.deepEqual(recorder().normalize(message), [
    { type: "claude.activity", data: { ...message, raw_response: message } },
  ]);
});

test("Claude preserves an unrecognized system subtype as raw activity", () => {
  const message = {
    type: "system",
    subtype: "future_subtype",
    uuid: "sdk-uuid",
    session_id: "sdk-session",
    extra: { nested: [0, false, null, "retained"] },
  };

  assert.deepEqual(recorder().normalizeUnrecognized(message), [
    { type: "claude.activity", data: { ...message, raw_response: message } },
  ]);
});

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

void topLevelActivityTypes;

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

test("Claude preserves an unrecognized message kind and its raw fields", () => {
  const message = {
    type: "future_sdk_message",
    event: { type: "future_delta", value: 0 },
    enabled: false,
  };

  assert.deepEqual(recorder().normalizeUnrecognized(message), [
    { type: "claude.activity", data: { ...message, raw_response: message } },
  ]);
});

test("Claude preserves familiar event contracts and their full SDK envelope", () => {
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
        name: "Read",
        input: { file_path: "a.ts", count: 0, enabled: false },
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
      data: { model: init.model, tools: init.tools, raw_response: init },
    },
    {
      type: "agent.message",
      data: {
        role: "assistant",
        message_id: assistant.message.id,
        parent_tool_use_id: assistant.parent_tool_use_id,
        text: "Checking",
        content: { type: "text", text: "Checking" },
        raw_response: assistant,
      },
    },
    {
      type: "tool.started",
      data: {
        id: "tool",
        name: "Read",
        input: { file_path: "a.ts", count: 0, enabled: false },
        raw_response: assistant,
      },
    },
    {
      type: "tool.completed",
      data: {
        id: "tool",
        error: false,
        content: [{ type: "text", text: "file output" }],
        raw_response: user,
      },
    },
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
    assert.deepEqual(event.data.raw_response, message);
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

  assert.ok(events.every((event) => event.data.raw_response === message));
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
      assert.deepEqual(event.data.raw_response, message);
    }

    if (text !== undefined) {
      assert.equal(first.data.text, text);
    }
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

const assistantErrorNames = Object.keys(
  assistantErrors,
) as SDKAssistantMessageError[];

// The records name every SDK value, so an SDK upgrade that adds one fails typecheck.
test("Claude preserves every assistant error code", () => {
  for (const error of assistantErrorNames) {
    const message = assistantMessage([], "sdk-message", { error });

    assert.deepEqual(
      recorder().normalize(message),
      [
        {
          type: "claude.activity",
          data: { ...message, raw_response: message },
        },
      ],
      error,
    );
  }
});

const resultSubtypes: Record<SDKResultMessage["subtype"], true> = {
  success: true,
  error_max_turns: true,
  error_during_execution: true,
  error_max_budget_usd: true,
  error_max_structured_output_retries: true,
};

const resultSubtypeNames = Object.keys(resultSubtypes) as Array<
  SDKResultMessage["subtype"]
>;

test("Claude results of every subtype retain accounting and the full result", () => {
  for (const subtype of resultSubtypeNames) {
    const message = resultMessage(subtype);

    assert.deepEqual(
      recorder().normalize(message),
      [
        {
          type: "agent.completed",
          data: { ...message, cost_usd: 0, raw_response: message },
        },
      ],
      subtype,
    );
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
      undefined,
      readyClaudeCli,
    );

    if (failed) {
      await assert.rejects(provider.run(context, "Review"), /error_max_turns/);
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
    assert.deepEqual(done.data.raw_response, message);
  }
});
