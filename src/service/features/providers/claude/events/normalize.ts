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

/**
 * Translates an SDK message into task events: assistant and user content
 * blocks become messages and tool calls, init and result become the turn's
 * start and completion, and anything else is kept as opaque Claude activity.
 */
export function normalizeClaudeMessage(
  c: RunContext,
  m: SDKMessage,
  fullEvents = false,
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
            input: isRecord(b.input) ? b.input : {},
          });
        } else if (b.type === "tool_result") {
          const content = Array.isArray(b.content)
            ? b.content.map(claudeActivityContent)
            : b.content;

          emit("tool.completed", {
            id: b.tool_use_id,
            error: b.is_error,
            content,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
