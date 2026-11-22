import type { PlanStepStatus } from "../../../../shared/tasks/plan-contract";
import { Icon } from "../../../shared/components/icons/icons";

type PlanStepIconProps = {
  status: PlanStepStatus;
  /** A message reached the worker after the plan, so the current step waits. */
  stale?: boolean;
  /** The current step turns slowly while the worker is on it. */
  spin?: boolean;
};

/** A step's status as Claude Code draws it, named for screen readers. */
export function PlanStepIcon({ status, stale, spin }: PlanStepIconProps) {
  if (status === "completed") {
    return <Icon name="check-circle-filled" size={14} label="Done" />;
  }

  if (status === "pending") {
    return <Icon name="circle-dashed" size={14} label="Pending" />;
  }

  return stale ? (
    <Icon
      name="more-circle"
      size={14}
      label="Waiting for the worker to update the plan"
    />
  ) : (
    <Icon
      name="circle-progress"
      size={14}
      label="In progress"
      className={spin ? "plan-step-spin" : undefined}
    />
  );
}
