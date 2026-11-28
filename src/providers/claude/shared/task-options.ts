import { z } from "zod";

import { optionsForProvider } from "../../../core/shared/providers/options.js";
import {
  contextUsageSchema,
  promptCacheSchema,
} from "../../../core/shared/providers/session-reports.js";
import {
  approvalDeciderSchema,
  type Task,
} from "../../../core/shared/tasks/model.js";
import {
  claudePermissionModeSchema,
  claudePolicySchema,
  permissionModeSchema,
} from "./permissions.js";

export const claudeStartOptionsSchema = z.strictObject({
  permission_mode: permissionModeSchema.optional(),
  approval_decider: approvalDeciderSchema.optional(),
  /** Runs Bash in Claude Code's sandbox. Unset uses the setting. */
  sandbox: z.boolean().optional(),
});

/**
 * What a session ran with where it differs from what the task asked for. Kept
 * apart, so the requested values stay as they were. Claude Code reports the
 * mode, so it isn't limited to the modes this version knows.
 */
const claudeEffectiveSettingsSchema = z.strictObject({
  permission_mode: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
});

export type ClaudeEffectiveSettings = z.infer<
  typeof claudeEffectiveSettingsSchema
>;

/** Options stored on a task, with the permission mode resolved. */
export const claudeTaskOptionsSchema = z.strictObject({
  permission_mode: claudePermissionModeSchema,
  approval_decider: approvalDeciderSchema,
  permission_source: z.enum(["task", "profile", "setting"]),
  claude_policy: claudePolicySchema,
  effective: claudeEffectiveSettingsSchema.optional(),
  prompt_cache: promptCacheSchema.optional(),
  context_usage: contextUsageSchema.optional(),
});

export function readClaudeTaskOptions(task: Pick<Task, "provider_options">) {
  return claudeTaskOptionsSchema.parse(
    optionsForProvider(task.provider_options, "claude"),
  );
}
