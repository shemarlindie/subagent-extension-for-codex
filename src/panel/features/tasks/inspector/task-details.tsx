import type { ReactElement, ReactNode } from "react";

import { providerTaskFacts } from "../../../../shared/providers/presentation";
import { profileLabel } from "../../../app/state/selectors";
import type { Task } from "../../../app/state/types";
import { SkeletonShape } from "../../../shared/components/loading-skeleton/loading-skeleton";
import { LoadingSwap } from "../../../shared/components/loading-skeleton/loading-swap";
import { useNow } from "../../../shared/utils/use-now";
import {
  formatUserDateTime,
  type UserDateTimePreferences,
} from "../../../shared/utils/user-date-time";
import { changesSummary } from "../../changes/read-changes";
import type { ChangeCountsState } from "../../changes/types";
import { WorktreeActions } from "../../changes/worktree-actions";
import { formatDuration, runtimeLive, taskRuntimeMs } from "../list/duration";
import {
  ESTIMATED_COST_LABEL,
  EstimatedCostLabel,
} from "./estimated-cost-label";
import { TaskDetailsSkeleton } from "./task-details-skeleton";

type TaskDetailsProps = {
  task?: Task;
  /** The selected task's change totals, read live for the tab count and Details. */
  counts?: ChangeCountsState;
  /** The host's locale and time zone, as used by Chat and Activity. */
  preferences?: UserDateTimePreferences;
};

type DetailsValueProps = {
  loading: boolean;
  children: ReactNode;
  skeleton: ReactElement;
  className?: string;
};

function DetailsValue({
  loading,
  children,
  skeleton,
  className,
}: DetailsValueProps) {
  return (
    <LoadingSwap
      as="span"
      className={["task-details-value-swap", "loading-swap-inline", className]
        .filter(Boolean)
        .join(" ")}
      loading={loading}
      busy={false}
      skeleton={skeleton}
    >
      {children}
    </LoadingSwap>
  );
}

// Facts that keep the user's line breaks.
const multilineFacts = new Set(["Description", "Custom instructions"]);

/** The changes fact: a live summary, or why there is none. */
function changesFact(counts?: ChangeCountsState) {
  if (counts?.error) return counts.error;
  if (!counts?.data) return "Reading…";

  return changesSummary(counts.data);
}

function taskDate(timestamp: string, preferences?: UserDateTimePreferences) {
  if (!Number.isFinite(Date.parse(timestamp))) return "Unavailable";

  return (
    <time
      dateTime={timestamp}
      title={formatUserDateTime(timestamp, preferences, {
        timeZoneName: undefined,
      })}
    >
      {formatUserDateTime(timestamp, preferences, {
        second: undefined,
        timeZoneName: undefined,
      })}
    </time>
  );
}

export function TaskDetails({ task, counts, preferences }: TaskDetailsProps) {
  const now = useNow(Boolean(task && runtimeLive(task)));
  const changesPending = !counts?.data && !counts?.error;

  const facts: Record<string, ReactNode> | undefined = task
    ? {
        "Task ID": task.id,
        Created: taskDate(task.created_at, preferences),
        "Latest activity": taskDate(task.updated_at, preferences),
        Description: task.description,
        Worker: `${task.provider} · ${profileLabel(task.worker_profile)}`,
        ...providerTaskFacts(task),
        Model: task.model || "Worker default",
        "Reasoning effort": task.reasoning_effort || "Worker default",
        ...(task.profile_instructions
          ? { "Custom instructions": task.profile_instructions }
          : {}),
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
        [ESTIMATED_COST_LABEL]:
          task.cost_usd === undefined
            ? "Unavailable"
            : `$${task.cost_usd.toFixed(3)}`,
      }
    : undefined;

  const skeletonFactTexts = facts
    ? Object.fromEntries(
        Object.entries(facts).map(([label, value]) => [
          label,
          typeof value === "string" || typeof value === "number"
            ? String(value)
            : "",
        ]),
      )
    : undefined;

  return (
    <LoadingSwap
      className="task-details-loading-swap"
      loading={!task}
      busy={false}
      skeleton={
        <TaskDetailsSkeleton task={task} factTexts={skeletonFactTexts} />
      }
    >
      {task && facts ? (
        <div className="task-details">
          <div className="meta">
            <span className="task-details-meta-project">
              {task.repository.split("/").at(-1)} · {task.revision} ·{" "}
              {task.workspace_strategy === "current_repo"
                ? "current repository"
                : "isolated worktree"}
            </span>
            <span className="task-details-meta-runtime">
              {task.budget.max_runtime_minutes === null
                ? "No runtime limit"
                : `${task.budget.max_runtime_minutes} min limit`}
            </span>
            <span className="task-details-meta-cost">
              {task.budget.max_cost_usd === null
                ? "No cost limit"
                : `$${task.budget.max_cost_usd} budget`}
            </span>
          </div>
          <dl className="facts">
            {Object.entries(facts).map(([label, value]) => (
              <div className="fact" key={label}>
                <dt>
                  {label === ESTIMATED_COST_LABEL ? (
                    <EstimatedCostLabel />
                  ) : (
                    label
                  )}
                </dt>
                <dd
                  className={
                    multilineFacts.has(label)
                      ? "task-fact-multiline"
                      : undefined
                  }
                >
                  {label === "Changes" ? (
                    <DetailsValue
                      loading={changesPending}
                      className="task-details-changes-value-swap"
                      skeleton={
                        <span className="task-details-changes-skeleton">
                          <SkeletonShape className="task-details-changes-count" />
                          <SkeletonShape className="task-details-changes-files" />
                          <SkeletonShape className="task-details-changes-state" />
                        </span>
                      }
                    >
                      {changesPending ? null : value}
                    </DetailsValue>
                  ) : (
                    value
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {counts?.data && <WorktreeActions task={task} changes={counts} />}
        </div>
      ) : null}
    </LoadingSwap>
  );
}
