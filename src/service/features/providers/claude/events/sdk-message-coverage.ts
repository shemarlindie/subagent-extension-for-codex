// Nothing imports this module. Its exhaustive records make an SDK upgrade that
// adds a message type, system subtype or assistant error fail typechecking, so
// someone reviews how activity.ts presents it before adding it here.
import type {
  SDKAssistantMessageError,
  SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

type SdkSystemSubtype = Exclude<
  Extract<SDKMessage, { type: "system" }>["subtype"],
  "init"
>;

const systemSubtypes: Record<SdkSystemSubtype, true> = {
  status: true,
  api_retry: true,
  compact_boundary: true,
  control_request_progress: true,
  model_refusal_fallback: true,
  model_refusal_no_fallback: true,
  local_command_output: true,
  hook_started: true,
  hook_progress: true,
  hook_response: true,
  plugin_install: true,
  task_notification: true,
  task_started: true,
  task_updated: true,
  task_progress: true,
  background_tasks_changed: true,
  thinking_tokens: true,
  session_state_changed: true,
  worker_shutting_down: true,
  commands_changed: true,
  notification: true,
  files_persisted: true,
  memory_recall: true,
  elicitation_complete: true,
  permission_denied: true,
  mirror_error: true,
  informational: true,
};

void systemSubtypes;

type SdkTopLevelActivity = Exclude<
  SDKMessage["type"],
  "assistant" | "user" | "result" | "system"
>;

const topLevelActivityTypes: Record<SdkTopLevelActivity, true> = {
  stream_event: true,
  tool_progress: true,
  tool_use_summary: true,
  auth_status: true,
  rate_limit_event: true,
  prompt_suggestion: true,
  conversation_reset: true,
};

void topLevelActivityTypes;

const assistantErrors: Record<SDKAssistantMessageError, true> = {
  authentication_failed: true,
  oauth_org_not_allowed: true,
  account_on_hold: true,
  verification_required: true,
  billing_error: true,
  rate_limit: true,
  overloaded: true,
  invalid_request: true,
  model_not_found: true,
  server_error: true,
  unknown: true,
  max_output_tokens: true,
  cloud_credential_error: true,
};

void assistantErrors;
