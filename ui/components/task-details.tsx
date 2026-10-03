import { Collapsible } from "@base-ui/react/collapsible";
import { approvalLabels } from "../../src/core/model";
import {
  permissionLabels,
  approvalDecider,
  taskClaudeMode,
  claudeOverrideLabels,
} from "../../src/core/permissions";
import { Chevron } from "./chevron";
import type { Task } from "../core/types";
export function TaskDetails({ task }: { task: Task }) {
  const facts = {
    "Task ID": task.id,
    ...(task.provider === "claude"
      ? {
          "Permission mode":
            permissionLabels[taskClaudeMode(task) ?? "inherit"],
          "Permission source": task.permission_source ?? "Provider default",
          "Approval decision maker":
            approvalDecider(task) === "parent_agent" ? "Parent agent" : "User",
          ...(task.claude_policy
            ? {
                "Session restrictions": [
                  `Sandbox: ${claudeOverrideLabels.claude_sandbox[task.claude_policy.sandbox]}`,
                  `Environment: ${claudeOverrideLabels.claude_environment[task.claude_policy.environment]}`,
                  `Tools: ${claudeOverrideLabels.claude_tools[task.claude_policy.tools]}`,
                  `Path guard: ${task.claude_policy.path_guard ? "On" : "Off"}`,
                  `Subagents: ${task.claude_policy.subagents ? "On" : "Off"}`,
                ].join(" · "),
              }
            : {}),
        }
      : { "Approval mode": approvalLabels[task.approval_mode ?? "ask_user"] }),
    Model: task.model || "Provider runtime default",
    "Reasoning effort": task.reasoning_effort || "Provider runtime default",
    Workspace: task.workspace ?? "Preparing",
    Repository: task.repository,
    "Workspace strategy":
      task.workspace_strategy === "current_repo"
        ? "Current repository"
        : "Isolated worktree",
    "Base commit": task.base_commit ?? task.revision,
    Session: task.session_id ?? "Not started",
    Dependencies: task.depends_on.join(", ") || "None",
    Attempt: task.attempt,
    "Runtime used": `${Math.round(task.runtime_ms / 1000)}s`,
    "Reported cost":
      task.cost_usd === undefined
        ? "Unavailable"
        : `$${task.cost_usd.toFixed(3)}`,
  };
  return (
    <Collapsible.Root className="task-details">
      <Collapsible.Trigger className="task-details-trigger">
        <Chevron />
        Task details
      </Collapsible.Trigger>
      <Collapsible.Panel className="task-details-content">
        <dl className="facts">
          {Object.entries(facts).map(([label, value]) => (
            <div className="fact" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
