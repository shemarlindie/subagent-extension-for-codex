import type {
  ApprovalDecider,
  ClaudePermissionMode,
  ClaudePolicy,
  PermissionMode,
} from "./permissions.js";

/** @strict */
export interface ClaudeStartOptions {
  permission_mode?: PermissionMode;
  approval_decider?: ApprovalDecider;
}

/**
 * Options stored on a task, with the permission mode resolved.
 *
 * @strict
 */
export interface ClaudeTaskOptions {
  permission_mode: ClaudePermissionMode;
  approval_decider: ApprovalDecider;
  permission_source: "task" | "setting";
  claude_policy: ClaudePolicy;
}
