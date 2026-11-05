import { z } from "zod";

import { approvalDeciderSchema, type Task } from "../../tasks/model.js";
import { optionsForProvider } from "../options.js";
import {
  claudePermissionModeSchema,
  claudePolicySchema,
  permissionModeSchema,
} from "./permissions.js";

export const claudeStartOptionsSchema = z.strictObject({
  permission_mode: permissionModeSchema.optional(),
  approval_decider: approvalDeciderSchema.optional(),
});

/**
 * What a session ran with where it differs from what the task asked for. Kept
 * apart, so the requested values stay as they were. Claude Code reports the
 * mode, so it isn't limited to the modes this version knows.
 */
const claudeEffectiveSettingsSchema = z.strictObject({
  permission_mode: z.string().optional(),
  model: z.string().optional(),
});

export type ClaudeEffectiveSettings = z.infer<
  typeof claudeEffectiveSettingsSchema
>;

/** Options stored on a task, with the permission mode resolved. */
export const claudeTaskOptionsSchema = z.strictObject({
  permission_mode: claudePermissionModeSchema,
  approval_decider: approvalDeciderSchema,
  permission_source: z.enum(["task", "setting"]),
  claude_policy: claudePolicySchema,
  effective: claudeEffectiveSettingsSchema.optional(),
});

export function readClaudeTaskOptions(task: Pick<Task, "provider_options">) {
  return claudeTaskOptionsSchema.parse(
    optionsForProvider(task.provider_options, "claude"),
  );
}
