import type { Task } from "../../tasks/model.js";
import { optionsForProvider } from "../options.js";
import { claudeOverrideLabels, permissionLabel } from "./permissions.js";
import { claudeTaskOptionsSchema } from "./task-options.js";

/** A task's native permission facts, or none when its stored options are invalid. */
export const claudeTaskFacts = (task: Task): Record<string, string> => {
  const parsed = claudeTaskOptionsSchema.safeParse(
    optionsForProvider(task.provider_options, "claude"),
  );

  if (!parsed.success) return {};

  const options = parsed.data,
    policy = options.claude_policy;

  return {
    "Permission mode": permissionLabel(options.permission_mode),
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
