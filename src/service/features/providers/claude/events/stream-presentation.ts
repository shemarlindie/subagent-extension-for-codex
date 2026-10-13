import type {
  SDKMessage,
  SDKPartialAssistantMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type {
  ActivityContent,
  ActivityContentBlock,
  ActivityPresentation,
} from "../../../../../shared/providers/activity/types.js";
import { scalarText } from "../../../../../shared/text.js";
import { claudeActivityBlock, claudeActivityContent } from "./content.js";
import { decodeClaudeActivityContent } from "./content.js";

type ClaudeStreamMessage = Extract<SDKMessage, { type: "stream_event" }>;

type ClaudeStreamEvent = SDKPartialAssistantMessage["event"];

type ClaudeStreamDelta = Extract<
  ClaudeStreamEvent,
  { type: "content_block_delta" }
>;

type ActivityStream = NonNullable<ActivityPresentation["stream"]>;

function streamDeltaUpdate(frame: ClaudeStreamDelta): ActivityStream["update"] {
  const { delta, index } = frame;

  switch (delta.type) {
    case "text_delta":
      return {
        index,
        append: { field: "text", type: "text", text: delta.text },
      };
    case "thinking_delta":
      return {
        index,
        append: {
          field: "thinking",
          type: "thinking",
          text: delta.thinking,
        },
      };
    case "input_json_delta":
      return {
        index,
        append: {
          field: "partial_json",
          type: "input_json_delta",
          text: delta.partial_json,
        },
      };
    case "citations_delta":
    case "compaction_delta":
    case "signature_delta":
      return undefined;
  }
}

function streamFrameContent(
  frame: ClaudeStreamEvent,
): ActivityContent | undefined {
  switch (frame.type) {
    case "content_block_start":
      return claudeActivityBlock(frame.content_block);
    case "content_block_delta":
      return claudeActivityContent(frame.delta);
    case "message_delta":
      return {
        type: "opaque",
        data: Object.fromEntries(Object.entries(frame.delta)),
      };
    case "content_block_stop":
    case "message_start":
    case "message_stop":
      return undefined;
  }
}

/** Translates a typed live Claude stream frame into provider-neutral activity. */
function liveStreamPresentation(message: ClaudeStreamMessage): ActivityStream {
  const frame = message.event;
  const index = "index" in frame ? frame.index : undefined;
  const content = streamFrameContent(frame);

  const stream: ActivityStream = {
    id: message.parent_tool_use_id ?? "root",
    messageId: frame.type === "message_start" ? frame.message.id : undefined,
    started: frame.type === "message_start",
    completed: frame.type === "message_stop",
    title: frame.type.replace(/[_.]/g, " "),
    ...(content !== undefined ? { content } : {}),
    details: Object.fromEntries(
      Object.entries(frame).filter(([key]) => key !== "type"),
    ),
  };

  if (index !== undefined) {
    if (frame.type === "content_block_start") {
      stream.update = {
        index,
        block: claudeActivityBlock(frame.content_block),
      };
    } else if (frame.type === "content_block_delta") {
      stream.update = streamDeltaUpdate(frame);
    }
  }

  return stream;
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function storedStreamContent(value: unknown): ActivityContent | undefined {
  return decodeClaudeActivityContent(value);
}

function storedStreamBlock(value: unknown): ActivityContentBlock | undefined {
  const content = storedStreamContent(value);

  if (typeof content === "string") return { type: "text", text: content };

  return content;
}

function storedStreamUpdate(
  index: number,
  frame: Record<string, unknown>,
): ActivityStream["update"] {
  if (frame.type === "content_block_start") {
    const block = storedStreamBlock(frame.content_block);

    return block ? { index, block } : undefined;
  }

  if (frame.type !== "content_block_delta") return undefined;

  const delta = object(frame.delta);

  switch (delta.type) {
    case "text_delta":
      return {
        index,
        append: {
          field: "text",
          type: "text",
          text: scalarText(delta.text),
        },
      };
    case "thinking_delta":
      return {
        index,
        append: {
          field: "thinking",
          type: "thinking",
          text: scalarText(delta.thinking),
        },
      };
    case "input_json_delta":
      return {
        index,
        append: {
          field: "partial_json",
          type: "input_json_delta",
          text: scalarText(delta.partial_json),
        },
      };
    default:
      return undefined;
  }
}

/** Decodes a current serialized stream frame or translates its typed live form. */
export function claudeStreamPresentation(
  data: Record<string, unknown>,
  rawResponse?: SDKMessage,
): ActivityStream {
  if (rawResponse?.type === "stream_event") {
    return liveStreamPresentation(rawResponse);
  }

  const frame = object(data.event);
  const frameType = typeof frame.type === "string" ? frame.type : undefined;
  const message = object(frame.message);

  const stream: ActivityStream = {
    id: scalarText(data.parent_tool_use_id, "root"),
    messageId: typeof message.id === "string" ? message.id : undefined,
    started: frameType === "message_start",
    completed: frameType === "message_stop",
    title: scalarText(frameType, "Streaming").replace(/[_.]/g, " "),
    details: Object.fromEntries(
      Object.entries(frame).filter(([key]) => key !== "type"),
    ),
  };

  const content = storedStreamContent(frame.delta ?? frame.content_block);
  if (content !== undefined) stream.content = content;

  const index = frame.index ?? 0;

  if (typeof index === "number" && Number.isSafeInteger(index) && index >= 0) {
    stream.update = storedStreamUpdate(index, frame);
  }

  return stream;
}
