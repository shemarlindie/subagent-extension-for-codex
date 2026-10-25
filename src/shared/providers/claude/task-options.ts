import { z } from "zod";

import type { Task } from "../../tasks/model.js";
import { optionsForProvider } from "../options.js";
import {
  approvalDeciderSchema,
  claudePermissionModeSchema,
  claudePolicySchema,
  permissionModeSchema,
} from "./permissions.js";

export const claudeStartOptionsSchema = z.strictObject({
  permission_mode: permissionModeSchema.optional(),
  approval_decider: approvalDeciderSchema.optional(),
});

/** Options stored on a task, with the permission mode resolved. */
export const claudeTaskOptionsSchema = z.strictObject({
  permission_mode: claudePermissionModeSchema,
  approval_decider: approvalDeciderSchema,
  permission_source: z.enum(["task", "setting"]),
  claude_policy: claudePolicySchema,
});

export function readClaudeTaskOptions(task: Pick<Task, "provider_options">) {
  return claudeTaskOptionsSchema.parse(
    optionsForProvider(task.provider_options, "claude"),
  );
}
