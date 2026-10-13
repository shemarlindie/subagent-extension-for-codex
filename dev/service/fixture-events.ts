import type {
  SDKAssistantMessageError,
  SDKMessage,
  SDKResultMessage,
} from "@anthropic-ai/claude-agent-sdk";

import { claudeActivityPresentation } from "../../src/service/features/providers/claude/events/activity.js";
import type { ActivityPresentation } from "../../src/shared/providers/activity/types.js";
import type { FixtureStreamFrame } from "./fixture-scenarios.js";

type SdkSystemActivity = Exclude<
  Extract<SDKMessage, { type: "system" }>["subtype"],
  "init"
>;

type SdkTopLevelActivity = Exclude<
  SDKMessage["type"],
  "assistant" | "user" | "result" | "system" | "stream_event"
>;

type FixtureSdkActivityType = SdkSystemActivity | SdkTopLevelActivity;

// Keep these records exhaustive against the installed SDK's SDKMessage union.
// A newly added SDK event must get a deterministic fixture payload before typecheck passes.
const systemActivityDefaults: Record<
  SdkSystemActivity,
  Record<string, unknown>
> = {
  compact_boundary: {
    compact_metadata: { trigger: "auto", pre_tokens: 12000 },
  },
  status: { status: "requesting" },
  api_retry: {
    attempt: 2,
    max_retries: 5,
    retry_delay_ms: 1000,
    error_status: 503,
    error: "Fixture retry",
  },
  control_request_progress: {
    request_id: "fixture-request",
    status: "started",
  },
  model_refusal_fallback: {
    trigger: "refusal",
    direction: "retry",
    scope: "session",
    original_model: "fixture-default",
    fallback_model: "fixture-fast",
    request_id: "fixture-request",
    content: "Fixture response retried on a fallback model.",
  },
  model_refusal_no_fallback: {
    original_model: "fixture-default",
    request_id: "fixture-request",
    content: "Fixture refusal has no fallback model.",
  },
  local_command_output: { content: "Fixture command output." },
  hook_started: {
    hook_id: "fixture-hook",
    hook_name: "PreToolUse",
    description: "Fixture hook started.",
  },
  hook_progress: {
    hook_id: "fixture-hook",
    hook_name: "PreToolUse",
    description: "Fixture hook is running.",
  },
  hook_response: {
    hook_id: "fixture-hook",
    hook_name: "PreToolUse",
    description: "Fixture hook finished.",
    outcome: "success",
  },
  plugin_install: { plugin: "fixture-plugin", status: "completed" },
  task_notification: {
    task_id: "fixture-background-task",
    description: "Fixture background task finished.",
    status: "completed",
  },
  task_started: {
    task_id: "fixture-background-task",
    description: "Fixture background task started.",
    status: "running",
  },
  task_updated: {
    task_id: "fixture-background-task",
    description: "Fixture background task updated.",
    status: "running",
  },
  task_progress: {
    task_id: "fixture-background-task",
    description: "Fixture background task progress.",
    status: "running",
  },
  background_tasks_changed: {
    tasks: [
      {
        task_id: "fixture-background-task",
        task_type: "local_agent",
        description: "Fixture background task.",
      },
    ],
  },
  thinking_tokens: { estimated_tokens: 128, estimated_tokens_delta: 16 },
  session_state_changed: { state: "requires_action" },
  worker_shutting_down: { reason: "fixture_shutdown" },
  commands_changed: { commands: [] },
  notification: {
    key: "fixture",
    text: "Fixture notification.",
    priority: "medium",
  },
  files_persisted: { files: ["fixture/sample.txt"] },
  memory_recall: { content: "Fixture recalled memory." },
  elicitation_complete: { message: "Fixture input completed." },
  permission_denied: {
    tool_name: "Bash",
    message: "Fixture permission was denied.",
  },
  mirror_error: { error: "Fixture transcript sync failed." },
  informational: { content: "Fixture informational event.", level: "notice" },
};

const topLevelActivityDefaults: Record<
  SdkTopLevelActivity,
  Record<string, unknown>
> = {
  tool_progress: {
    tool_use_id: "fixture-tool-use",
    tool_name: "Read",
    parent_tool_use_id: null,
    elapsed_time_seconds: 1,
  },
  auth_status: { isAuthenticating: false, output: [] },
  tool_use_summary: { summary: "Fixture tool summary." },
  rate_limit_event: { rate_limit_info: { status: "allowed" } },
  prompt_suggestion: { suggestion: "Continue the fixture scenario." },
  conversation_reset: {
    new_conversation_id: "fixture-session-reset",
    trigger: "clear",
  },
};

const assistantErrorDefaults: Record<
  SDKAssistantMessageError,
  Record<string, unknown>
> = {
  authentication_failed: { message: { content: [] } },
  oauth_org_not_allowed: { message: { content: [] } },
  account_on_hold: { message: { content: [] } },
  verification_required: { message: { content: [] } },
  billing_error: { message: { content: [] } },
  rate_limit: { message: { content: [] } },
  overloaded: { message: { content: [] } },
  invalid_request: { message: { content: [] } },
  model_not_found: { message: { content: [] } },
  server_error: { message: { content: [] } },
  unknown: { message: { content: [] } },
  max_output_tokens: { message: { content: [] } },
  cloud_credential_error: { message: { content: [] } },
};

const sdkResultSubtypes: Record<SDKResultMessage["subtype"], true> = {
  success: true,
  error_during_execution: true,
  error_max_turns: true,
  error_max_budget_usd: true,
  error_max_structured_output_retries: true,
};

const activityDefaults: Record<
  | SdkSystemActivity
  | SdkTopLevelActivity
  | "init"
  | "assistant"
  | "user"
  | "stream_event",
  Record<string, unknown>
> = {
  ...systemActivityDefaults,
  ...topLevelActivityDefaults,
  init: { session_id: "fixture-session", model: "fixture-default", tools: [] },
  assistant: {
    message: { content: [{ type: "text", text: "Fixture assistant event." }] },
  },
  user: {
    message: { content: [{ type: "text", text: "Fixture user event." }] },
  },
  stream_event: {
    parent_tool_use_id: null,
    event: {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Fixture stream delta." },
    },
  },
};

export const fixtureSdkActivityTypes: readonly FixtureSdkActivityType[] = [
  ...(Object.keys(systemActivityDefaults) as SdkSystemActivity[]),
  ...(Object.keys(topLevelActivityDefaults) as SdkTopLevelActivity[]),
];

export const fixtureSdkSystemActivityTypes: readonly SdkSystemActivity[] =
  Object.keys(systemActivityDefaults) as SdkSystemActivity[];

export const fixtureSdkAssistantErrorTypes: readonly SDKAssistantMessageError[] =
  Object.keys(assistantErrorDefaults) as SDKAssistantMessageError[];

export const fixtureSdkResultSubtypes: readonly SDKResultMessage["subtype"][] =
  Object.keys(sdkResultSubtypes) as SDKResultMessage["subtype"][];

function field(fields: Record<string, unknown>, key: string) {
  const value = fields[key];

  return value === undefined ? undefined : String(value);
}

function setFieldPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const parts = path.split(".");
  let current = target;

  for (const part of parts.slice(0, -1)) {
    if (["__proto__", "prototype", "constructor"].includes(part)) return;
    const next = current[part];

    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[part] = {};
    }

    current = current[part] as Record<string, unknown>;
  }

  const last = parts.at(-1)!;

  if (!["__proto__", "prototype", "constructor"].includes(last)) {
    current[last] = value;
  }
}

export function applyFixtureFieldOverrides(
  target: Record<string, unknown>,
  fields: Record<string, unknown>,
) {
  for (const [key, value] of Object.entries(fields)) {
    setFieldPath(target, key, value);
  }
}

export function fixtureActivityPayload(
  type: string,
  fields: Record<string, unknown>,
  taskId: string,
  turn: number,
): Record<string, unknown> & {
  activity: ActivityPresentation;
  raw_response: Record<string, unknown>;
} {
  const defaults = Object.hasOwn(activityDefaults, type)
    ? activityDefaults[type as keyof typeof activityDefaults]
    : { message: `Fixture ${type} activity.` };

  const data: Record<string, unknown> = structuredClone(defaults);

  applyFixtureFieldOverrides(data, fields);
  data.type = type;

  const isSystemEvent =
    type === "init" || Object.hasOwn(systemActivityDefaults, type);

  const rawResponse = {
    ...data,
    type: isSystemEvent ? "system" : type,
    ...(isSystemEvent ? { subtype: type } : {}),
    session_id: `fixture_${taskId}`,
    uuid: `fixture_activity_${taskId}_${turn}_${type}`,
  };

  return presentFixtureActivity({ ...data, raw_response: rawResponse });
}

function fixtureContentDelta(
  deltaType: string,
  text: string,
  fields: Record<string, unknown>,
) {
  if (deltaType === "thinking") {
    return { type: "thinking_delta", thinking: text };
  }

  if (deltaType === "input_json") {
    return {
      type: "input_json_delta",
      partial_json: field(fields, "partial_json") ?? '{"path":"fixture"}',
    };
  }

  return { type: "text_delta", text };
}

export function fixtureStreamPayload(
  frame: FixtureStreamFrame,
  fields: Record<string, unknown>,
  taskId: string,
  turn: number,
): Record<string, unknown> & {
  activity: ActivityPresentation;
  raw_response: Record<string, unknown>;
} {
  const messageId = `fixture_stream_${taskId}_${turn}`;
  const index = typeof fields.index === "number" ? fields.index : 0;
  const blockType = field(fields, "block") ?? "text";
  const deltaType = field(fields, "delta") ?? "text";
  const text = field(fields, "text") ?? "Fixture stream delta.";
  const event: Record<string, unknown> = { type: frame };

  if (frame === "message_start") {
    event.message = {
      id: field(fields, "message_id") ?? messageId,
      role: "assistant",
      content: [],
    };
  }

  if (frame.startsWith("content_block_")) event.index = index;

  if (frame === "content_block_start") {
    event.content_block = {
      type: blockType,
      ...(blockType === "text" ? { text: "" } : {}),
      ...(blockType === "thinking" ? { thinking: "" } : {}),
      ...(blockType === "tool_use"
        ? {
            id: field(fields, "tool_use_id") ?? `fixture_tool_use_${turn}`,
            name: field(fields, "name") ?? "Read",
            input: {},
          }
        : {}),
    };
  }

  if (frame === "content_block_delta") {
    event.delta = fixtureContentDelta(deltaType, text, fields);
  }

  if (frame === "message_delta") {
    event.delta = {
      stop_reason: field(fields, "stop_reason") ?? "end_turn",
      stop_sequence: null,
    };
  }

  for (const [key, value] of Object.entries(fields)) {
    if (
      [
        "frame",
        "index",
        "block",
        "delta",
        "text",
        "partial_json",
        "stop_reason",
        "message_id",
        "tool_use_id",
        "name",
        "parent_tool_use_id",
      ].includes(key)
    ) {
      continue;
    }

    setFieldPath(event, key, value);
  }

  const parentToolUseId = fields.parent_tool_use_id ?? null;

  const rawResponse = {
    type: "stream_event",
    parent_tool_use_id: parentToolUseId,
    event,
    session_id: `fixture_${taskId}`,
    uuid: `fixture_stream_event_${taskId}_${turn}`,
  };

  const data: Record<string, unknown> & { raw_response: typeof rawResponse } = {
    type: "stream_event",
    parent_tool_use_id: parentToolUseId,
    event,
    raw_response: rawResponse,
  };

  return presentFixtureActivity(data);
}

function presentFixtureActivity(
  data: Record<string, unknown> & { raw_response: Record<string, unknown> },
) {
  return {
    ...data,
    activity: claudeActivityPresentation({ type: "claude.activity", data }),
  };
}
