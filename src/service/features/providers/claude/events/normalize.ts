import type {
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type { EventPayloadMap } from "../../../../../core/shared/events/event-contract.js";
import type { EventType } from "../../../../../core/shared/events/event-types.js";
import type { ActivityContent } from "../../../../../core/shared/providers/activity/types.js";
import { normalizedClaudeFields } from "../../../../../providers/claude/shared/responses.js";
import type { RunContext } from "../../types.js";
import { isWorkerTool } from "../runtime/worker-tool-names.js";
import {
  claudeActivityContent,
  claudeActivityPresentation,
} from "./activity.js";

const fileTools = new Set(["Read", "Write", "Edit", "NotebookEdit"]);

const fileContentFields = new Set([
  "content",
  "old_string",
  "new_string",
  "new_source",
]);

export const fileContentOmitted = "File content isn't stored.";

type ToolResultBlock = Extract<
  Exclude<SDKUserMessage["message"]["content"], string>[number],
  { type: "tool_result" }
>;

/** What a command that ran in Claude Code printed, from its replayed message. */
export function localCommandOutput(m: SDKMessage) {
  if (m.type !== "user" || !("isReplay" in m)) return undefined;
  const content = m.message.content;

  return typeof content === "string"
    ? /^<local-command-stdout>([\s\S]*)<\/local-command-stdout>$/
        .exec(content)?.[1]
        ?.trim() || undefined
    : undefined;
}

/**
 * Creates the normalizer for one run. Outside full events it leaves out file
 * contents, so it remembers file tool calls to recognize their results.
 */
export function claudeMessageNormalizer(fullEvents = false) {
  const state: NormalizerState = {
    fileToolIds: fullEvents ? undefined : new Set<string>(),
    workerToolIds: new Set<string>(),
    compacted: false,
  };

  return (c: RunContext, m: SDKMessage, measured?: ClaudeMeasurements) =>
    normalizeClaudeMessage(c, m, fullEvents, state, measured);
}

/**
 * What the provider measured when a message arrived, kept with its activity:
 * after a compaction, the context size the context usage meter shows.
 */
export type ClaudeMeasurements = { context_tokens_after?: number };

/** The measurements an event kept, so tools can derive it again. */
export function keptMeasurements(
  data: Record<string, unknown>,
): ClaudeMeasurements | undefined {
  return typeof data.context_tokens_after === "number"
    ? { context_tokens_after: data.context_tokens_after }
    : undefined;
}

type NormalizerState = {
  fileToolIds: Set<string> | undefined;
  /** Worker tool calls, whose results are left out with them. */
  workerToolIds: Set<string>;
  /** A compaction ran, so the next synthetic user message is its summary. */
  compacted: boolean;
};

/**
 * A system message that stands in for a user message Claude Code adds itself:
 * a command's output, or the summary a compaction continues from.
 */
function standInMessage(m: SDKMessage, state: NormalizerState) {
  if (m.type === "system" && m.subtype === "compact_boundary") {
    state.compacted = true;
  }

  if (m.type !== "user") return undefined;
  const output = localCommandOutput(m);

  if (output !== undefined) {
    // The same shape as the SDK's own local_command_output message.
    return {
      type: "system",
      subtype: "local_command_output",
      uuid: m.uuid,
      content: output,
    };
  }

  if (
    state.compacted &&
    m.isSynthetic &&
    typeof m.message.content === "string"
  ) {
    state.compacted = false;

    return {
      type: "system",
      subtype: "compact_summary",
      uuid: m.uuid,
      text: m.message.content,
    };
  }

  return undefined;
}

/**
 * Translates an SDK message into task events: assistant and user content
 * blocks become messages and tool calls, init and result become the turn's
 * start and completion, and anything else is kept as opaque Claude activity.
 */
function normalizeClaudeMessage(
  c: RunContext,
  m: SDKMessage,
  fullEvents: boolean,
  state: NormalizerState,
  measured: ClaudeMeasurements | undefined,
) {
  const { fileToolIds, workerToolIds } = state;
  const responseRef = fullEvents ? globalThis.crypto.randomUUID() : undefined;
  let recorded = false;

  const originalResponseFields = () => {
    if (!responseRef) return {};

    const fields = {
      response_ref: responseRef,
      ...(!recorded ? { raw_response: m } : {}),
    };

    recorded = true;

    return fields;
  };

  // Whether the message also becomes activity: when it's empty or failed, or
  // under full events when its blocks recorded nothing, as worker tool blocks
  // don't, so its original response still reaches diagnostics.
  const unrecorded = (content: readonly unknown[]) =>
    !content.length ||
    ("error" in m && Boolean(m.error)) ||
    (responseRef !== undefined && !recorded);

  const emit = <K extends EventType, D extends EventPayloadMap[K]>(
    type: K,
    data: D,
  ) => {
    const messageFields =
      (type === "agent.message" || type === "agent.content") &&
      (m.type === "assistant" || m.type === "user")
        ? {
            message_id: m.type === "assistant" ? m.message.id : m.uuid,
            parent_tool_use_id: m.parent_tool_use_id,
          }
        : {};

    const payload = { ...messageFields, ...data, ...originalResponseFields() };

    const activity = claudeActivityPresentation({
      type,
      data: payload,
      rawResponse: m,
    });

    c.emit(type, { ...payload, activity });
  };

  // `message` can be a system message that stands in for `m`, such as a
  // command's output in place of its replayed user message.
  const emitActivity = (message: object) => {
    const payload = {
      ...normalizedClaudeFields(message),
      ...measured,
      ...originalResponseFields(),
    };

    const activity = claudeActivityPresentation({
      type: "claude.activity",
      data: payload,
      rawResponse: m,
    });

    c.emitOpaque("claude.activity", { ...payload, activity });
  };

  // An assistant message's text block repeats its text, so only user content
  // keeps one.
  const emitText = (text: string, content: ActivityContent) => {
    if (m.type === "assistant") emit("agent.message", { role: m.type, text });
    else emit("agent.content", { role: "user", text, content });
  };

  const emitToolResult = (b: ToolResultBlock) => {
    const content = Array.isArray(b.content)
      ? b.content.map(claudeActivityContent)
      : b.content;

    // A failed file tool keeps its error text.
    const fileResult = fileToolIds?.delete(b.tool_use_id) && !b.is_error;

    emit("tool.completed", {
      id: b.tool_use_id,
      error: b.is_error,
      content: fileResult ? fileContentOmitted : content,
    });
  };

  const standIn = standInMessage(m, state);

  if (standIn) {
    emitActivity(standIn);
  } else if (m.type === "assistant" || m.type === "user") {
    const content = m.message.content;

    if (typeof content === "string") {
      emitText(content, content);
    } else {
      for (const b of content) {
        if (b.type === "text") {
          emitText(b.text, claudeActivityContent(b));
        } else if (b.type === "tool_use" && isWorkerTool(b.name)) {
          // Worker tools show no rows. Those with events record them themselves.
          workerToolIds.add(b.id);
        } else if (b.type === "tool_use") {
          emit("tool.started", {
            id: b.id,
            name: b.name,
            input: storedToolInput(b.id, b.name, b.input, fileToolIds),
          });
        } else if (b.type === "tool_result") {
          if (!workerToolIds.delete(b.tool_use_id)) emitToolResult(b);
        } else {
          emit("agent.content", {
            role: m.type,
            content: claudeActivityContent(b),
          });
        }
      }

      if (unrecorded(content)) emitActivity(m);
    }
  } else if (m.type === "system" && m.subtype === "init") {
    emit("agent.started", { model: m.model, tools: m.tools });
  } else if (m.type === "result") {
    const fields = normalizedClaudeFields(m);
    // The service records a successful result as the turn's reply.
    if (!m.is_error) delete fields.result;

    emit("agent.completed", {
      ...fields,
      cost_usd: m.total_cost_usd,
      usage: m.usage,
    });
  } else {
    emitActivity(m);
  }
}

/** File tool input keeps its paths and options, without file contents. */
function storedToolInput(
  id: string,
  name: string,
  value: unknown,
  fileToolIds: Set<string> | undefined,
) {
  const input = isRecord(value) ? value : {};
  if (!fileToolIds || !fileTools.has(name)) return input;

  fileToolIds.add(id);

  return Object.fromEntries(
    Object.entries(input).filter(([key]) => !fileContentFields.has(key)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
