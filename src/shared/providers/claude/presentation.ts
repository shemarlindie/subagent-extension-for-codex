import type { Task } from "../../tasks/model.js";
import { optionsForProvider } from "../options.js";
import {
  claudeOverrideLabels,
  type ClaudePermissionMode,
  permissionLabel,
} from "./permissions.js";
import { claudeTaskOptionsSchema } from "./task-options.js";

/** A task's native permission facts, or none when its stored options are invalid. */
export const claudeTaskFacts = (task: Task): Record<string, string> => {
  const parsed = claudeTaskOptionsSchema.safeParse(
    optionsForProvider(task.provider_options, "claude"),
  );

  if (!parsed.success) return {};

  const options = parsed.data,
    policy = options.claude_policy;

  const { effective } = options;

  return {
    "Permission mode": permissionLabel(
      (effective?.permission_mode ??
        options.permission_mode) as ClaudePermissionMode,
    ),
    ...(effective?.permission_mode
      ? {
          "Requested permission mode": permissionLabel(options.permission_mode),
        }
      : {}),
    ...(effective?.model ? { "Effective model": effective.model } : {}),
    "Permission source": options.permission_source,
    "Approval decision maker":
      options.approval_decider === "parent_agent" ? "Parent agent" : "User",
    "Session restrictions": [
      `Sandbox: ${claudeOverrideLabels.sandbox[policy.sandbox]}`,
      `Tools: ${claudeOverrideLabels.tools[policy.tools]}`,
      `Path guard: ${policy.path_guard ? "On" : "Off"}`,
      `Subagents: ${policy.subagents ? "On" : "Off"}`,
      `Claude Code settings: ${policy.settings_files ? "On" : "Off"}`,
      `Your MCP servers: ${policy.settings_files && policy.user_mcp ? "On" : "Off"}`,
    ].join(" · "),
  };
};
