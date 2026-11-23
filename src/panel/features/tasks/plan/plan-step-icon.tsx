import type { PlanStepStatus } from "../../../../shared/tasks/plan-contract";
import { Icon } from "../../../shared/components/icons/icons";

/**
 * Where the worker is on the current step: on it, stopped for compaction, input
 * or the end of the turn, or past it since a message reached it after the
 * plan. Activity's past rows leave it out.
 */
export type PlanStepState = "working" | "paused" | "stale";

type PlanStepIconProps = { status: PlanStepStatus; state?: PlanStepState };

/** A step's status as Claude Code draws it, named for screen readers. */
export function PlanStepIcon({ status, state }: PlanStepIconProps) {
  if (status === "completed") {
    return <Icon name="check-circle-filled" size={14} label="Done" />;
  }

  if (status === "pending") {
    return <Icon name="circle-dashed" size={14} label="Pending" />;
  }

  if (state === "paused" || state === "stale") {
    return (
      <Icon
        name="more-circle"
        size={14}
        label={
          state === "stale"
            ? "Waiting for the worker to update the plan"
            : "Paused"
        }
      />
    );
  }

  // The current step turns slowly while the worker is on it.
  return (
    <Icon
      name="circle-progress"
      size={14}
      label="In progress"
      className={state === "working" ? "plan-step-spin" : undefined}
    />
  );
}
