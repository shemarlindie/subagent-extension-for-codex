import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { contentText } from "../../../../../shared/providers/activity/content-text.js";
import type {
  ActivityContent,
  ActivityPresentation,
} from "../../../../../shared/providers/activity/types.js";
import { decodeClaudeRateLimitWindowInfo } from "../../../../../shared/providers/claude/events.js";
import { claudeRateLimitWindows } from "../../../../../shared/providers/claude/rate-limit-windows.js";
import { scalarText } from "../../../../../shared/text.js";
import { decodeClaudeActivityContent } from "./content.js";
import { claudeStreamPresentation } from "./stream-presentation.js";

export {
  claudeActivityContent,
  decodeClaudeActivityContent,
} from "./content.js";

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

const string = (v: unknown) => (typeof v === "string" ? v : undefined);

type ActivityEvent = { type: string; data: object; rawResponse?: SDKMessage };

const activityKind = (e: ActivityEvent) => {
  const data = object(e.data);

  return e.type === "claude.activity"
    ? String(data.subtype ?? data.type)
    : e.type;
};

function activityFailed(e: ActivityEvent) {
  const d = object(e.data);

  return (
    d.error === true ||
    d.is_error === true ||
    d.outcome === "error" ||
    d.compact_result === "failed" ||
    d.status === "failed" ||
    object(d.patch).status === "failed" ||
    ["task.failed", "permission_denied", "mirror_error"].includes(
      activityKind(e),
    ) ||
    (typeof d.error === "string" &&
      !!d.error &&
      activityKind(e) !== "api_retry") ||
    (e.type === "agent.completed" &&
      typeof d.subtype === "string" &&
      d.subtype !== "success")
  );
}

const quiet = new Set([
  "agent.started",
  "agent.turn_started",
  "task.started",
  "task.queued",
  "task.continued",
  "init",
  "status",
  "session_state_changed",
  "api_retry",
  "auth_status",
  "rate_limit_event",
  "compact_boundary",
  "files_persisted",
  "plugin_install",
  "elicitation_complete",
]);

const thinking = new Set([
  "thinking_tokens",
  "thinking.tokens",
  "agent.thinking_tokens",
]);

function statusTitle(e: ActivityEvent) {
  const key = activityKind(e),
    d = object(e.data);

  if (thinking.has(key)) return "Thinking…";

  if (key === "status") {
    if (d.compact_result === "failed") return "Context compaction failed";
    if (d.status === "compacting") return "Compacting context";
    if (d.status === "requesting") return "Requesting";

    return "Working";
  }

  if (key === "api_retry") {
    return `Retrying request${typeof d.attempt === "number" ? ` · attempt ${d.attempt}` : ""}`;
  }

  if (key === "compact_boundary") return "Context compacted";

  if (key === "auth_status") {
    return d.isAuthenticating
      ? "Connecting to Claude"
      : "Authentication updated";
  }

  if (key === "session_state_changed") {
    if (d.state === "requires_action") return "Needs input";
    if (d.state === "idle") return "Turn finished";

    return "Working";
  }

  if (key === "rate_limit_event") {
    return decodeClaudeRateLimitWindowInfo(d.rate_limit_info)?.status ===
      "rejected"
      ? "Waiting for rate limit reset"
      : "Rate limit updated";
  }

  if (key === "files_persisted") return "Files saved";
  if (key === "plugin_install") return "Updating plugins";
  if (key === "task.queued") return "Queued";
  if (key === "task.started") return "Task started";
  if (key === "task.continued") return "Task continued";
  if (["agent.started", "init"].includes(key)) return "Claude connected";

  return "Working";
}

function hasThinkingContent(e: ActivityEvent) {
  const hasThinkingBlock = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(hasThinkingBlock);
    const block = object(value);

    return (
      block.type === "thinking" ||
      block.type === "thinking_delta" ||
      (Array.isArray(block.content) && hasThinkingBlock(block.content))
    );
  };

  const nativeMessage = object(e.rawResponse);
  const storedMessage = object(object(e.data).raw_response);

  const rawMessage = object(
    nativeMessage.message ?? storedMessage.message ?? object(e.data).message,
  );

  return (
    hasThinkingBlock(object(e.data).content) ||
    hasThinkingBlock(rawMessage.content)
  );
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

function failureSummary(event: ActivityEvent) {
  const d = object(event.data);

  const textOutput = contentText(d.content);

  return [
    d.compact_error,
    d.error,
    object(d.patch).error,
    d.message,
    d.stderr,
    d.output,
    textOutput,
    Array.isArray(d.errors) ? d.errors.map(String).join("; ") : undefined,
  ].find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

function activityBodyContent(value: unknown): ActivityContent[] | undefined {
  if (typeof value === "string") return [value];

  if (Array.isArray(value)) {
    const blocks: ActivityContent[] = [];

    for (const item of value) {
      const block = decodeClaudeActivityContent(item);
      if (block === undefined) return undefined;
      blocks.push(block);
    }

    return blocks;
  }

  return undefined;
}

/** Labels an SDK activity event, or a transcript content row. */
function activityTitle(e: ActivityEvent, key: string) {
  if (e.type === "claude.activity") {
    return (
      sdkTitles[key] ??
      key.charAt(0).toUpperCase() + key.slice(1).replace(/[_.]/g, " ")
    );
  }

  if (e.type === "agent.content") {
    return object(e.data).role === "user" ? "User content" : "Claude content";
  }

  return undefined;
}

/** Groups tool, hook and background task progress under one operation. */
function operationIdFor(
  key: string,
  d: Record<string, unknown>,
  toolId: string | undefined,
) {
  if (toolId) return `tool:${toolId}`;

  if (key.startsWith("hook_") && d.hook_id) {
    return `hook:${scalarText(d.hook_id)}`;
  }

  if (key.startsWith("task_") && d.task_id) {
    return `background:${scalarText(d.task_id)}`;
  }

  return undefined;
}

/** Names the operation that a tool, hook or background task event belongs to. */
function operationTitle(
  key: string,
  d: Record<string, unknown>,
  toolId: string | undefined,
) {
  if (toolId) return "Tool";

  if (key.startsWith("hook_")) {
    return `Hook · ${scalarText(d.hook_name, "Hook")}`;
  }

  return "Background task";
}

/** Claude SDK details are translated at the provider boundary. */
export function claudeActivityPresentation(
  e: ActivityEvent,
): ActivityPresentation {
  const d = object(e.data),
    key = activityKind(e);

  const rateLimitInfo =
    e.rawResponse?.type === "rate_limit_event"
      ? e.rawResponse.rate_limit_info
      : decodeClaudeRateLimitWindowInfo(d.rate_limit_info);

  const presentation: ActivityPresentation = {
    kind: key,
    quiet: quiet.has(key),
    failed: activityFailed(e),
    summary:
      (activityFailed(e) ? failureSummary(e) : undefined) ??
      string(
        d.compact_error ??
          d.text ??
          d.summary ??
          d.description ??
          d.message ??
          d.error ??
          d.result,
      ) ??
      (Array.isArray(d.errors) ? d.errors.map(String).join("; ") : undefined),
    ...(e.type === "claude.activity" && d.type === "result"
      ? { summaryIsResponse: true }
      : {}),
    thinking: thinking.has(key),
    liveStatus:
      [
        "status",
        "api_retry",
        "session_state_changed",
        "rate_limit_event",
      ].includes(key) || thinking.has(key),
    statusTitle:
      quiet.has(key) || thinking.has(key) ? statusTitle(e) : undefined,
    title: activityTitle(e, key),
    messageId: string(
      (e.rawResponse?.type === "assistant"
        ? e.rawResponse.message.id
        : undefined) ??
        object(object(d.raw_response).message).id ??
        object(d.raw_response).uuid,
    ),
    hasThinking: hasThinkingContent(e),
  };

  if (key === "session_state_changed") {
    if (d.state === "requires_action") presentation.statusState = "info";
    if (d.state === "idle") presentation.statusState = "completed";
  }

  if (key === "rate_limit_event" && rateLimitInfo) {
    const windows = claudeRateLimitWindows(rateLimitInfo);
    if (windows.length) presentation.rateLimitWindows = windows;
  }

  if (key === "rate_limit_event" && rateLimitInfo?.status === "rejected") {
    presentation.statusState = "info";
  }

  const toolId = key === "tool_progress" ? string(d.tool_use_id) : undefined;

  const operationId = operationIdFor(key, d, toolId);

  if (operationId) {
    presentation.operation = {
      id: operationId,
      kind: toolId ? "tool" : "operation",
      title: operationTitle(key, d, toolId),
      summary: string(
        d.description ?? d.summary ?? object(d.patch).description,
      ),
      started: key === "hook_started" || key === "task_started",
      completed:
        key === "hook_response" ||
        key === "task_notification" ||
        ["completed", "stopped"].includes(
          String(d.status ?? object(d.patch).status),
        ),
      stopped:
        d.outcome === "cancelled" ||
        ["stopped", "killed"].includes(
          String(d.status ?? object(d.patch).status),
        ),
    };
  }

  if (key === "stream_event") {
    presentation.stream = claudeStreamPresentation(d, e.rawResponse);
  }

  if (
    e.type === "claude.activity" &&
    (d.type === "assistant" || d.type === "user")
  ) {
    let role: "assistant" | "user" = d.type;
    let contentValue: unknown;
    const native = e.rawResponse;

    if (native?.type === "assistant" || native?.type === "user") {
      role = native.type;
      contentValue = native.message.content;
    } else {
      const message = object(d.message);

      if (message.role === "assistant" || message.role === "user") {
        role = message.role;
      }

      contentValue = message.content ?? d.content;
    }

    const content = activityBodyContent(contentValue);

    const error =
      typeof d.error === "boolean" || typeof d.error === "string"
        ? d.error
        : undefined;

    presentation.body = {
      role,
      ...(content ? { content } : {}),
      ...(error !== undefined ? { error } : {}),
    };
  }

  return presentation;
}
