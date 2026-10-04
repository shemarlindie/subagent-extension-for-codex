import type { Event } from "../core/types";

// Keep prose blocks and structured metadata within the same nesting budget.
export const MAX_ACTIVITY_DEPTH = 6;

export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const label = (key: string) => {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.]/g, " ");

  return words.charAt(0).toUpperCase() + words.slice(1);
};

export function formatActivityTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const sdkTitles: Record<string, string> = {
  init: "Claude connected",
  status: "Claude status",
  compact_boundary: "Context compacted",
  api_retry: "Retrying API request",
  local_command_output: "Command output",
  hook_started: "Hook started",
  hook_progress: "Hook progress",
  hook_response: "Hook finished",
  task_started: "Background task started",
  task_updated: "Background task updated",
  task_progress: "Background task progress",
  task_notification: "Background task finished",
  session_state_changed: "Session state changed",
  notification: "Notification",
  files_persisted: "Files saved",
  memory_recall: "Recalled from memory",
  plugin_install: "Plugin installation",
  elicitation_complete: "Input completed",
  permission_denied: "Permission denied",
  mirror_error: "Transcript sync failed",
  tool_progress: "Tool running",
  tool_use_summary: "Tool summary",
  auth_status: "Authentication",
  rate_limit_event: "Rate limit update",
  prompt_suggestion: "Suggested next prompt",
  assistant: "Claude response",
  user: "User message",
  stream_event: "Response streaming",
};

function sdkTitle(data: Record<string, unknown>) {
  const key = String(data.subtype ?? data.type ?? "activity");

  return sdkTitles[key] ?? label(key);
}

export function eventTitle(event: Event, failed: boolean, toolName?: string) {
  const { data } = event;
  if (event.type === "claude.activity") return sdkTitle(data);
  if (event.type === "agent.message") return "Worker message";
  if (event.type === "agent.content")
    return data.role === "user" ? "User content" : "Claude content";
  if (event.type === "tool.started") return `${data.name ?? "Tool"} started`;
  if (event.type === "tool.completed")
    return `${toolName ?? "Tool"} ${failed ? "failed" : "completed"}`;
  if (event.type === "agent.started") return "Agent started";
  if (event.type === "agent.completed")
    return `Agent ${failed ? "failed" : "finished"}`;

  return label(event.type);
}

/** Rebuilds visible content blocks from SDK stream start and delta events. */
export function streamContent(events: Event[]) {
  const blocks = new Map<number, Record<string, unknown>>();

  for (const event of events) {
    const frame = record(event.data.event);
    const index = frame.index ?? 0;
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0)
      continue;
    if (frame.type === "content_block_start")
      blocks.set(index, { ...record(frame.content_block) });

    if (frame.type === "content_block_delta") {
      const delta = record(frame.delta);
      const block = blocks.get(index) ?? {};

      if (delta.type === "text_delta") {
        block.type = "text";
        block.text = String(block.text ?? "") + String(delta.text ?? "");
      }

      if (delta.type === "thinking_delta") {
        block.type = "thinking";

        block.thinking =
          String(block.thinking ?? "") + String(delta.thinking ?? "");
      }

      if (delta.type === "input_json_delta") {
        block.type = "input_json_delta";

        block.partial_json =
          String(block.partial_json ?? "") + String(delta.partial_json ?? "");
      }

      blocks.set(index, block);
    }
  }

  return [...blocks.values()];
}

function isThinkingBlock(block: unknown) {
  const type = record(block).type;

  return type === "thinking" || type === "redacted_thinking";
}

/** True when every message in the group holds only thinking blocks. */
export function thinkingOnly(events: Event[]) {
  return (
    events.length > 0 &&
    events.every((event) => {
      // The provider emits one content block per event; accept arrays too.
      const content = event.data.content ?? event.data.text;
      const blocks = Array.isArray(content) ? content : [content];

      return blocks.length > 0 && blocks.every(isThinkingBlock);
    })
  );
}
