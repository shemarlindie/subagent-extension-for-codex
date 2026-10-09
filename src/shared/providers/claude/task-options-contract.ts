import type {
  ApprovalDecider,
  ClaudePolicy,
  PermissionMode,
} from "./permissions.js";

/** @strict */
export interface ClaudeStartOptions {
  permission_mode?: PermissionMode;
  approval_decider?: ApprovalDecider;
}

/** @strict */
export interface ClaudeTaskOptions extends ClaudeStartOptions {
  permission_source?: "task" | "setting" | "task_profile" | "user_config";
  claude_policy?: ClaudePolicy;
}
