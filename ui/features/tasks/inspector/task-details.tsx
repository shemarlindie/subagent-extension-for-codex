import {
  approvalDecider,
  claudeOverrideLabels,
  permissionLabels,
  taskClaudeMode,
} from "../../../../src/features/tasks/policy/permissions";
import { approvalLabels } from "../../../../src/shared/contracts";
import { useNow } from "../../../shared/components/use-now";
import { profileLabel } from "../../../shared/state/selectors";
import type { Task } from "../../../shared/state/types";
import { changesSummary } from "../../changes/read-changes";
import type { ChangesState } from "../../changes/types";
import { WorktreeActions } from "../../changes/worktree-actions";
import { formatDuration, runtimeLive, taskRuntimeMs } from "../list/duration";

type TaskDetailsProps = {
  task: Task;
  /** The task's changes, read live when Details opens. */
  changes?: ChangesState;
};

/** The changes fact: a live summary, or why there is none. */
function changesFact(changes?: ChangesState) {
  if (changes?.error) return changes.error;
  if (!changes?.data) return "Reading…";
  if (changes.data.state === "branch_deleted")
    return "The worktree and its branch were deleted";

  const summary = `${changesSummary(changes.data)}${changes.scope === "turn" ? " in this turn" : ""}`;

  return changes.data.state === "workspace_missing"
    ? `${summary} on branch ${changes.data.branch}; the worktree was removed`
    : summary;
}

export function TaskDetails({ task, changes }: TaskDetailsProps) {
  const now = useNow(runtimeLive(task));

  const facts = {
    "Task ID": task.id,
    Worker: `${task.provider} · ${profileLabel(task.worker_profile)}`,
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
    ...(task.branch ? { Branch: task.branch } : {}),
    Changes: changesFact(changes),
    Repository: task.repository,
    "Workspace strategy":
      task.workspace_strategy === "current_repo"
        ? "Current repository"
        : "Isolated worktree",
    "Base commit": task.base_commit ?? task.revision,
    Session: task.session_id ?? "Not started",
    Dependencies: task.depends_on.join(", ") || "None",
    Attempt: task.attempt,
    "Runtime used": formatDuration(taskRuntimeMs(task, now)),
    "Reported cost":
      task.cost_usd === undefined
        ? "Unavailable"
        : `$${task.cost_usd.toFixed(3)}`,
  };

  return (
    <div className="task-details">
      <div className="meta">
        <span>
          {task.repository.split("/").at(-1)} · {task.revision} ·{" "}
          {task.workspace_strategy === "current_repo"
            ? "current repository"
            : "isolated worktree"}
        </span>
        <span>
          {task.budget.max_runtime_minutes === null
            ? "No runtime limit"
            : `${task.budget.max_runtime_minutes} min limit`}
        </span>
        <span>
          {task.budget.max_cost_usd === null
            ? "No cost limit"
            : `$${task.budget.max_cost_usd} budget`}
        </span>
      </div>
      <dl className="facts">
        {Object.entries(facts).map(([label, value]) => (
          <div className="fact" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {changes?.data && <WorktreeActions task={task} changes={changes} />}
    </div>
  );
}
