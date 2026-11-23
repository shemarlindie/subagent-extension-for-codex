import { currentActivityStatus } from "../../../../shared/tasks/activity/activity-status";
import { pinnedPlan } from "../../../../shared/tasks/plan";
import { useSnapshot } from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { Presence } from "../../../shared/components/motion/presence";
import { rowStatus } from "../list/task-status";
import { TaskStatusIcon } from "../list/task-status-icon";
import { PlanCard } from "../plan/plan-card";
import { composerMode } from "./chat-model";

type ChatProgressProps = {
  task?: Task;
  /** Called after the plan card changes size. */
  onPlanResize?: () => void;
};

/** The worker's plan and what it is doing now, above the composer. */
export function ChatProgress({ task, onPlanResize }: ChatProgressProps) {
  const { events } = useSnapshot(["events"]);

  let status: ReturnType<typeof rowStatus> | undefined;
  let activity: Task["live_activity"];

  if (task && composerMode(task) === "busy") {
    activity =
      task.status === "running" && events.length
        ? currentActivityStatus(events, task)
        : task.live_activity;

    status = rowStatus({ ...task, live_activity: activity });
    if (task.status === "running" && activity) status.label = activity.text;
  }

  const plan = pinnedPlan(task?.plan);

  // Input, a rate limit and compaction each stop work on the current step.
  const working =
    status?.kind === "running" && activity?.text !== "Compacting context";

  return (
    <>
      {/* Keyed so switching tasks swaps the card instead of animating it. */}
      {task && (
        <Presence key={task.id} show={Boolean(plan)}>
          {plan && (
            <PlanCard
              taskId={task.id}
              plan={plan}
              working={working}
              onResize={onPlanResize}
            />
          )}
        </Presence>
      )}
      <div className="chat-working" role="status" aria-atomic="true">
        {status && (
          <>
            <TaskStatusIcon
              kind={status.kind}
              label={status.label}
              decorative
            />
            <span title={status.label}>{status.label}</span>
          </>
        )}
      </div>
    </>
  );
}
