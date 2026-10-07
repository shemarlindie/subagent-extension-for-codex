import { z } from "zod";

import type { Task } from "../../tasks/model.js";
import { optionsForProvider } from "../options.js";
import {
  approvalDeciderSchema,
  claudePolicySchema,
  permissionModeSchema,
} from "./permissions.js";

export const claudeStartOptionsSchema = z.strictObject({
  permission_mode: permissionModeSchema.optional(),
  approval_decider: approvalDeciderSchema.optional(),
});

export const claudeTaskOptionsSchema = z.strictObject({
  permission_mode: permissionModeSchema.optional(),
  approval_decider: approvalDeciderSchema.optional(),
  permission_source: z
    .enum(["task", "setting", "task_profile", "user_config"])
    .optional(),
  claude_policy: claudePolicySchema.optional(),
});

export type ClaudeTaskOptions = z.infer<typeof claudeTaskOptionsSchema>;

export function readClaudeTaskOptions(task: Pick<Task, "provider_options">) {
  return claudeTaskOptionsSchema.parse(
    optionsForProvider(task.provider_options, "claude"),
  );
}
