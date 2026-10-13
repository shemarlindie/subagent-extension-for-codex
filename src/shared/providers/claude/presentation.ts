import type { Task } from "../../tasks/model.js";
import {
  approvalDecider,
  claudeOverrideLabels,
  permissionLabel,
} from "./permissions.js";
import { readClaudeTaskOptions } from "./task-options.js";

export const claudeTaskFacts = (task: Task): Record<string, string> => {
  const options = readClaudeTaskOptions(task),
    policy = options.claude_policy;

  return {
    "Permission mode": options.permission_mode
      ? permissionLabel(options.permission_mode)
      : "Provider default",
    "Permission source": options.permission_source ?? "Provider default",
    "Approval decision maker":
      approvalDecider(options) === "parent_agent" ? "Parent agent" : "User",
    ...(policy
      ? {
          "Session restrictions": [
            `Sandbox: ${claudeOverrideLabels.claude_sandbox[policy.sandbox]}`,
            `Environment: ${claudeOverrideLabels.claude_environment[policy.environment]}`,
            `Tools: ${claudeOverrideLabels.claude_tools[policy.tools]}`,
            `Path guard: ${policy.path_guard ? "On" : "Off"}`,
            `Subagents: ${policy.subagents ? "On" : "Off"}`,
          ].join(" · "),
        }
      : {}),
  };
};
