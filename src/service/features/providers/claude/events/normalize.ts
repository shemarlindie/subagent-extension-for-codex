import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type { EventPayloadMap } from "../../../../../shared/events/event-contract.js";
import type { EventType } from "../../../../../shared/events/event-types.js";
import type { ActivityContent } from "../../../../../shared/providers/activity/types.js";
import { normalizedClaudeFields } from "../../../../../shared/providers/claude/responses.js";
import type { RunContext } from "../../types.js";
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

/**
 * Creates the normalizer for one run. Outside full events it leaves out file
 * contents, so it remembers file tool calls to recognize their results.
 */
export function claudeMessageNormalizer(fullEvents = false) {
  const fileToolIds = fullEvents ? undefined : new Set<string>();

  return (c: RunContext, m: SDKMessage) =>
    normalizeClaudeMessage(c, m, fullEvents, fileToolIds);
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
  fileToolIds: Set<string> | undefined,
) {
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

  const emitActivity = (message: SDKMessage) => {
    const payload = {
      ...normalizedClaudeFields(message),
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

  if (m.type === "assistant" || m.type === "user") {
    const content = m.message.content;

    if (typeof content === "string") {
      emitText(content, content);
    } else {
      for (const b of content) {
        if (b.type === "text") {
          emitText(b.text, claudeActivityContent(b));
        } else if (b.type === "tool_use") {
          emit("tool.started", {
            id: b.id,
            name: b.name,
            input: storedToolInput(b.id, b.name, b.input, fileToolIds),
          });
        } else if (b.type === "tool_result") {
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
        } else {
          emit("agent.content", {
            role: m.type,
            content: claudeActivityContent(b),
          });
        }
      }

      if (!content.length || ("error" in m && m.error)) {
        emitActivity(m);
      }
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
