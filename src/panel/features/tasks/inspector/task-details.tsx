import { providerTaskFacts } from "../../../../shared/providers/presentation";
import { profileLabel } from "../../../app/state/selectors";
import type { Task } from "../../../app/state/types";
import { useNow } from "../../../shared/utils/use-now";
import { changesSummary } from "../../changes/read-changes";
import type { ChangeCountsState } from "../../changes/types";
import { WorktreeActions } from "../../changes/worktree-actions";
import { formatDuration, runtimeLive, taskRuntimeMs } from "../list/duration";

type TaskDetailsProps = {
  task: Task;
  /** The selected task's change totals, read live for the tab count and Details. */
  counts?: ChangeCountsState;
};

/** The changes fact: a live summary, or why there is none. */
function changesFact(counts?: ChangeCountsState) {
  if (counts?.error) return counts.error;
  if (!counts?.data) return "Reading…";
  if (counts.data.state === "branch_deleted")
    return "The worktree and its branch were deleted";
  if (counts.data.state === "end_unrecorded")
    return "Unavailable; the task ended before its end state was recorded";

  if (counts.data.state === "workspace_missing")
    return `On branch ${counts.data.branch}; the worktree was removed`;

  return `${changesSummary(counts.data)} uncommitted`;
}

export function TaskDetails({ task, counts }: TaskDetailsProps) {
  const now = useNow(runtimeLive(task));

  const facts = {
    "Task ID": task.id,
    Description: task.description,
    Worker: `${task.provider} · ${profileLabel(task.worker_profile)}`,
    ...providerTaskFacts(task),
    Model: task.model || "Provider runtime default",
    "Reasoning effort": task.reasoning_effort || "Provider runtime default",
    Workspace: task.workspace ?? "Preparing",
    ...(task.branch ? { Branch: task.branch } : {}),
    Changes: changesFact(counts),
    Repository: task.repository,
    "Workspace strategy":
      task.workspace_strategy === "current_repo"
        ? "Current repository"
        : "Isolated worktree",
    "Base commit": task.base_commit ?? task.revision,
    Session: task.session_id ?? "Not started",
    Dependencies: task.depends_on.join(", ") || "None",
    Turns: task.turn,
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
            <dd
              className={
                label === "Description" ? "task-full-description" : undefined
              }
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {counts?.data && <WorktreeActions task={task} changes={counts} />}
    </div>
  );
}
