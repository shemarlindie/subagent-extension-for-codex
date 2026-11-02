// Typed SDK messages and stable event ids for synthetic preview scenarios.
import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { claudeActivityPresentation } from "../../../src/service/features/providers/claude/events/activity";
import { normalizeClaudeMessage } from "../../../src/service/features/providers/claude/events/normalize";
import type { RunContext } from "../../../src/service/features/providers/types";
import { decodedEvent } from "../../../src/shared/events/decode";
import type { Event } from "../../../src/shared/events/types";
import { normalizedClaudeFields } from "../../../src/shared/providers/claude/responses";
import { at } from "./scenario-context";

export type Data = Record<string, unknown>;

type Uuid = SDKAssistantMessage["uuid"];

type Beta = SDKAssistantMessage["message"];

type AssistantBlock = Beta["content"][number];

type UserContent = Exclude<SDKUserMessage["message"]["content"], string>;

type UserBlock = UserContent[number];

/** SDK messages built by `sdk()`; the others have dedicated builders. */
type Plain = Exclude<
  SDKMessage,
  SDKAssistantMessage | SDKUserMessage | SDKResultMessage | SDKSystemMessage
>;

type Body<T> = T extends unknown ? Omit<T, "uuid" | "session_id"> : never;

export const SESSION = "preview-session";
export const MODEL = "claude-sonnet-5-5";

// A 64×64 checkerboard PNG, small enough to inline.
export const IMAGE =
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAa0lEQVR42u3XMQ0AIAxFQYRVE3LQhBJ0YKBMXSBcwtiBm15+WyPSF32m77b7BgAAAABQArzy0dM9AAAAAEANoMQAAAAA9oASAwAAANgDSgwAAABgDygxAAAAgD2gxAAAAAD2gBIDAAAAfAPY6lJReJDUYR4AAAAASUVORK5CYII=";

const usage: Beta["usage"] = {
  cache_creation: null,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  inference_geo: null,
  input_tokens: 120,
  iterations: null,
  output_tokens: 48,
  server_tool_use: null,
  service_tier: "standard",
  speed: "standard",
};

export const resultUsage = (
  input_tokens: number,
  output_tokens: number,
): SDKResultMessage["usage"] => ({
  cache_creation: {
    ephemeral_1h_input_tokens: 0,
    ephemeral_5m_input_tokens: 0,
  },
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  inference_geo: "not_available",
  input_tokens,
  iterations: [],
  output_tokens,
  server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
  service_tier: "standard",
  speed: "standard",
});

export const text = (value: string): AssistantBlock => ({
  type: "text",
  text: value,
  citations: null,
});

/** Builds ordered events for one task with stable ids and timestamps. */
export class Timeline {
  readonly events: Event[] = [];
  private clock: number;
  private count = 0;
  private uuids = 0;
  private tools = 0;
  private messages = 0;
  constructor(
    readonly taskId: string,
    start: string,
    private readonly firstId: number,
  ) {
    this.clock = Date.parse(start);
  }

  get end() {
    return new Date(this.clock).toISOString();
  }

  private uuid(): Uuid {
    return `00000000-0000-4000-8000-${String(this.firstId * 1000 + ++this.uuids).padStart(12, "0")}`;
  }

  private responseRefs = new WeakMap<object, string>();

  private messageId = () => `msg_${this.taskId}_${++this.messages}`;
  /** An event the service records itself (task lifecycle, input). */
  add(type: string, data: Data = {}, gapMs = 1500) {
    this.clock += gapMs;
    const raw = data.raw_response as SDKMessage | undefined;
    let recorded = data;

    if (raw) {
      const { raw_response: _raw, ...fields } = data;
      const first = !this.responseRefs.has(raw);

      if (first) {
        this.responseRefs.set(raw, `response-${this.firstId + this.count}`);
      }

      recorded = {
        ...fields,
        response_ref: this.responseRefs.get(raw),
        ...(first ? { raw_response: raw } : {}),
      };

      if (type === "claude.activity" || type === "agent.completed") {
        recorded = normalizedClaudeFields(recorded);
      }
    }

    this.events.push(
      decodedEvent({
        id: this.firstId + this.count++,
        task_id: this.taskId,
        type,
        timestamp: new Date(this.clock).toISOString(),
        data: raw
          ? {
              ...recorded,
              activity: claudeActivityPresentation({
                type,
                data: recorded,
                rawResponse: raw,
              }),
            }
          : data,
      }),
    );

    return this;
  }

  /** Most SDK messages surface unchanged as `claude.activity`. */
  sdk(body: Body<Plain>, gapMs?: number) {
    const message = {
      ...body,
      uuid: this.uuid(),
      session_id: SESSION,
    };

    return this.response(message, gapMs);
  }

  init(tools: string[]) {
    const message: SDKSystemMessage = {
      type: "system",
      subtype: "init",
      apiKeySource: "none",
      claude_code_version: "2.1.288",
      cwd: "/demo/project",
      tools,
      mcp_servers: [],
      model: MODEL,
      permissionMode: "plan",
      slash_commands: [],
      output_style: "default",
      skills: [],
      plugins: [],
      uuid: this.uuid(),
      session_id: SESSION,
    };

    return this.response(message);
  }

  /** One assistant message; each content block becomes its own event. */
  assistant(
    content: AssistantBlock[],
    id = this.messageId(),
    stop: Beta["stop_reason"] = null,
  ) {
    const message: SDKAssistantMessage = {
      type: "assistant",
      message: {
        id,
        container: null,
        content,
        context_management: null,
        model: MODEL,
        role: "assistant",
        stop_details: null,
        stop_reason: stop,
        stop_sequence: null,
        type: "message",
        usage,
      },
      parent_tool_use_id: null,
      uuid: this.uuid(),
      session_id: SESSION,
    };

    return this.response(message);
  }

  /** One user message; tool results become `tool.completed` events. */
  userMessage(content: UserContent, toolResponse?: Data) {
    const message: SDKUserMessage & { tool_use_result?: Data } = {
      type: "user",
      ...(toolResponse ? { tool_use_result: toolResponse } : {}),
      message: { role: "user", content },
      parent_tool_use_id: null,
      uuid: this.uuid(),
      session_id: SESSION,
    };

    return this.response(message);
  }

  say(value: string, id?: string) {
    return this.assistant([text(value)], id);
  }

  think(thinking: string, id?: string) {
    return this.assistant(
      [{ type: "thinking", thinking, signature: "synthetic-signature" }],
      id,
    );
  }

  user(value: string) {
    return this.userMessage([{ type: "text", text: value }]);
  }

  /** Thinking-token ticks that precede a reasoning step. */
  ticks(...estimates: number[]) {
    let previous = 0;

    for (const estimated_tokens of estimates) {
      this.sdk(
        {
          type: "system",
          subtype: "thinking_tokens",
          estimated_tokens,
          estimated_tokens_delta: estimated_tokens - previous,
        },
        600,
      );

      previous = estimated_tokens;
    }

    return this;
  }

  toolStart(name: string, input: Data) {
    const id = `toolu_${this.taskId}_${++this.tools}`;
    this.assistant([{ type: "tool_use", id, name, input }]);

    return id;
  }

  toolProgress(id: string, name: string, seconds: number) {
    return this.sdk(
      {
        type: "tool_progress",
        tool_use_id: id,
        tool_name: name,
        parent_tool_use_id: null,
        elapsed_time_seconds: seconds,
      },
      1000,
    );
  }

  toolDone(
    id: string,
    content: string | (UserBlock & { type: "text" | "image" })[],
    error?: boolean,
    toolResponse?: Data,
  ) {
    return this.userMessage(
      [{ type: "tool_result", tool_use_id: id, content, is_error: error }],
      toolResponse,
    );
  }

  /** A complete tool call: start, optional progress ticks, then its result. */
  tool(
    name: string,
    input: Data,
    content: Parameters<Timeline["toolDone"]>[1],
    options: { error?: boolean; progress?: number[] } = {},
  ) {
    const id = this.toolStart(name, input);

    for (const seconds of options.progress ?? []) {
      this.toolProgress(id, name, seconds);
    }

    return this.toolDone(id, content, options.error);
  }

  stream(event: Extract<Plain, { type: "stream_event" }>["event"]) {
    return this.sdk(
      { type: "stream_event", event, parent_tool_use_id: null },
      120,
    );
  }

  /** A streamed text response, optionally left unfinished (still running). */
  streamed(chunks: string[], finish = true, id = this.messageId()) {
    this.stream({
      type: "message_start",
      message: {
        id,
        container: null,
        content: [],
        context_management: null,
        model: MODEL,
        role: "assistant",
        stop_details: null,
        stop_reason: null,
        stop_sequence: null,
        type: "message",
        usage,
      },
    });

    this.stream({
      type: "content_block_start",
      index: 0,
      content_block: text(""),
    });

    for (const chunk of chunks) {
      this.stream({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: chunk },
      });
    }

    if (finish) {
      this.stream({ type: "content_block_stop", index: 0 });
      this.stream({ type: "message_stop" });
    }

    return this;
  }

  /**
   * The turn's result message, then the service's `agent.reply` and
   * `task.completed`.
   */
  finish(
    text: string,
    turn = 1,
    fields: Partial<Extract<SDKResultMessage, { subtype: "success" }>> = {},
  ) {
    return this.turnResult(text, fields)
      .reply(text, turn)
      .turnEnded(turn, "completed", fields.duration_ms, fields.total_cost_usd)
      .add("task.completed", { reply: text }, 200);
  }

  /** The service's record of how a turn ended, for its outcome row. */
  turnEnded(
    turn: number,
    outcome: "completed" | "failed" | "interrupted",
    runtime_ms = 64000,
    cost_usd = 0.42,
  ) {
    return this.add(
      "task.turn_ended",
      { turn, outcome, runtime_ms, cost_usd },
      100,
    );
  }

  /** The service's record of a turn's reply. */
  reply(text: string, turn = 1) {
    return this.add(
      "agent.reply",
      {
        text,
        turn,
      },
      100,
    );
  }

  /** The turn's result alone: the task is still running until the service records its end. */
  turnResult(
    summary: string,
    fields: Partial<Extract<SDKResultMessage, { subtype: "success" }>> = {},
  ) {
    return this.result({
      type: "result",
      subtype: "success",
      duration_ms: 64000,
      duration_api_ms: 51000,
      is_error: false,
      num_turns: 9,
      result: summary,
      stop_reason: "end_turn",
      total_cost_usd: 0.42,
      usage: resultUsage(4200, 980),
      modelUsage: {},
      permission_denials: [],
      uuid: this.uuid(),
      session_id: SESSION,
      ...fields,
    });
  }

  result(message: SDKResultMessage) {
    return this.response(message);
  }

  private response(message: SDKMessage, gapMs?: number) {
    const emit = (type: string, data: Data) =>
      this.add(type, { ...data, raw_response: message }, gapMs);

    normalizeClaudeMessage(
      { emit, emitOpaque: emit } as unknown as RunContext,
      message,
    );

    return this;
  }
}

export const begin = (t: Timeline, tools: string[]) =>
  t
    .add("task.queued", {}, 100)
    .add("task.started", { turn: 1 }, 300)
    .init(tools);

export const rateLimit = (
  t: Timeline,
  status: "allowed" | "rejected" = "allowed",
) => {
  const info = {
    status,
    rateLimitType: "five_hour" as const,
    utilization: status === "rejected" ? 1 : 0.12,
    resetsAt: 1791030000,
  };

  return t.sdk({
    type: "rate_limit_event",
    rate_limit_info: info,
  });
};

export const lifecycle = (
  id: string,
  start: number,
  ...rest: [string, Data?][]
) => {
  const t = new Timeline(
    id,
    at(start),
    parseInt(id.replace(/\D/g, "") || "0") + 800,
  );

  for (const [type, data] of rest) t.add(type, data);

  return t;
};
