import type { PlanStep } from "../../../../shared/tasks/plan-contract";
import { PlanStepIcon } from "./plan-step-icon";

type PlanStepsProps = {
  steps: PlanStep[];
  /** Shows only these steps, by index. */
  only?: number[];
  stale?: boolean;
  spin?: boolean;
};

/** A plan's steps with their status icons, in order. */
export function PlanSteps({ steps, only, stale, spin }: PlanStepsProps) {
  return (
    <ol className="plan-steps">
      {steps.map((step, index) =>
        only && !only.includes(index) ? null : (
          <li key={index} className="plan-step" data-status={step.status}>
            <PlanStepIcon status={step.status} stale={stale} spin={spin} />
            <span className="plan-step-text">{step.content}</span>
          </li>
        ),
      )}
    </ol>
  );
}
