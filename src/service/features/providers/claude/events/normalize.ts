import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import type { EventPayloadMap } from "../../../../../shared/events/event-contract.js";
import type { EventType } from "../../../../../shared/events/event-types.js";
import type { ClaudeEventPayload } from "../../../../../shared/providers/claude/events.js";
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
export function normalizeClaudeMessage(c: RunContext, m: SDKMessage) {
  // Keep the complete wire response on every derived activity, including
  // unknown SDK variants, so normalization never discards diagnostic context.
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

    const payload = { ...messageFields, ...data, raw_response: m };

    const activity = claudeActivityPresentation({
      type,
      data: payload,
      rawResponse: m,
    });

    c.emit(type, { ...payload, activity });
  };

  const emitActivity = (message: SDKMessage) => {
    const payload = {
      ...message,
      raw_response: message,
    } satisfies ClaudeEventPayload;

    const activity = claudeActivityPresentation({
      type: "claude.activity",
      data: payload,
      rawResponse: m,
    });

    c.emitOpaque("claude.activity", { ...payload, activity });
  };

  if (m.type === "assistant" || m.type === "user") {
    const content = m.message.content;

    if (typeof content === "string") {
      emit(m.type === "assistant" ? "agent.message" : "agent.content", {
        role: m.type,
        content,
        text: content,
      });
    } else {
      for (const b of content) {
        if (b.type === "text") {
          emit(m.type === "assistant" ? "agent.message" : "agent.content", {
            role: m.type,
            text: b.text,
            content: claudeActivityContent(b),
          });
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
    emit("agent.completed", {
      ...m,
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
