import type {
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

import type {
  ActivityContent,
  ActivityContentBlock,
} from "../../../../../shared/providers/activity/presentation-contract.js";

type AssistantContentBlock = Extract<
  SDKMessage,
  { type: "assistant" }
>["message"]["content"][number];

type UserContentBlock = Exclude<
  SDKUserMessage["message"]["content"],
  string
>[number];

type AssistantToolResultBlock = Extract<
  AssistantContentBlock,
  { type: "tool_result" }
>;

type UserToolResultBlock = Extract<UserContentBlock, { type: "tool_result" }>;

type NestedToolResultBlock =
  | Exclude<NonNullable<AssistantToolResultBlock["content"]>, string>[number]
  | Exclude<NonNullable<UserToolResultBlock["content"]>, string>[number];

type ContentBlockDelta = Extract<
  SDKPartialAssistantMessage["event"],
  { type: "content_block_delta" }
>["delta"];

export type ClaudeContentBlock =
  AssistantContentBlock | UserContentBlock | NestedToolResultBlock;

export type ClaudeContentInput =
  ClaudeContentBlock | ContentBlockDelta | string;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function opaqueContent(
  value: Exclude<ClaudeContentInput, string>,
): ActivityContent {
  return { type: "opaque", data: { ...value } };
}

function toolResultContent(
  value: AssistantToolResultBlock | UserToolResultBlock,
): ActivityContent {
  let content: string | ActivityContent[];

  if (value.content === undefined) content = "";
  else if (typeof value.content === "string") content = value.content;
  else content = value.content.map(claudeActivityContent);

  return {
    type: "tool_result",
    tool_use_id: value.tool_use_id,
    content,
    ...(value.is_error !== undefined ? { is_error: value.is_error } : {}),
  };
}

/** Converts known SDK blocks into common content and keeps other blocks opaque. */
// The SDK union requires an explicit opaque fallback for every current block.
// eslint-disable-next-line complexity
export function claudeActivityContent(
  value: ClaudeContentInput,
): ActivityContent {
  if (typeof value === "string") return value;

  switch (value.type) {
    case "text":
      return { type: "text", text: value.text };
    case "thinking":
      return { type: "thinking", thinking: value.thinking };
    case "input_json_delta":
      return { type: "input_json_delta", partial_json: value.partial_json };
    case "tool_use":
      return {
        type: "tool_use",
        id: value.id,
        name: value.name,
        input: record(value.input),
      };
    case "tool_result":
      return toolResultContent(value);
    case "advisor_tool_result":
    case "bash_code_execution_tool_result":
    case "citations_delta":
    case "code_execution_tool_result":
    case "compaction_delta":
    case "compaction":
    case "container_upload":
    case "document":
    case "image":
    case "mcp_tool_result":
    case "mcp_tool_use":
    case "redacted_thinking":
    case "search_result":
    case "server_tool_use":
    case "signature_delta":
    case "text_delta":
    case "text_editor_code_execution_tool_result":
    case "thinking_delta":
    case "tool_reference":
    case "tool_search_tool_result":
    case "web_fetch_tool_result":
    case "web_search_tool_result":
      return opaqueContent(value);

    default: {
      return opaqueContent(value);
    }
  }
}

function decodeToolResultContent(
  value: Record<string, unknown>,
): ActivityContent | undefined {
  if (typeof value.tool_use_id !== "string") return undefined;

  let content: string | ActivityContent[] = "";

  if (typeof value.content === "string") {
    content = value.content;
  } else if (Array.isArray(value.content)) {
    const blocks: ActivityContent[] = [];

    for (const item of value.content) {
      const block = decodeClaudeActivityContent(item);
      if (block === undefined) return undefined;
      blocks.push(block);
    }

    content = blocks;
  }

  return {
    type: "tool_result",
    tool_use_id: value.tool_use_id,
    content,
    ...(typeof value.is_error === "boolean"
      ? { is_error: value.is_error }
      : {}),
  };
}

/** Validates fixture or serialized content blocks before translating them. */
export function decodeClaudeActivityContent(
  value: unknown,
): ActivityContent | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;

  if (value.type === "text" && typeof value.text === "string") {
    return { type: "text", text: value.text };
  }

  if (value.type === "thinking" && typeof value.thinking === "string") {
    return { type: "thinking", thinking: value.thinking };
  }

  if (
    value.type === "input_json_delta" &&
    typeof value.partial_json === "string"
  ) {
    return { type: "input_json_delta", partial_json: value.partial_json };
  }

  if (value.type === "opaque" && isRecord(value.data)) {
    return { type: "opaque", data: value.data };
  }

  if (
    value.type === "tool_use" &&
    typeof value.id === "string" &&
    typeof value.name === "string"
  ) {
    return {
      type: "tool_use",
      id: value.id,
      name: value.name,
      input: record(value.input),
    };
  }

  if (value.type === "tool_result") {
    return typeof value.tool_use_id === "string"
      ? decodeToolResultContent(value)
      : { type: "opaque", data: value };
  }

  return { type: "opaque", data: value };
}

export function claudeActivityBlock(
  value: ClaudeContentBlock,
): ActivityContentBlock {
  const content = claudeActivityContent(value);

  return typeof content === "string"
    ? { type: "text", text: content }
    : content;
}
