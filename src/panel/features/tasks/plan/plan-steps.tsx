import type { PlanStep } from "../../../../core/shared/tasks/plan-contract";
import { PlanStepIcon, type PlanStepState } from "./plan-step-icon";

type PlanStepsProps = {
  steps: PlanStep[];
  /** Shows only these steps, by index. */
  only?: number[];
  state?: PlanStepState;
};

/** A plan's steps with their status icons, in order. */
export function PlanSteps({ steps, only, state }: PlanStepsProps) {
  return (
    <ol className="plan-steps">
      {steps.map((step, index) =>
        only && !only.includes(index) ? null : (
          <li key={index} className="plan-step" data-status={step.status}>
            <PlanStepIcon status={step.status} state={state} />
            <span className="plan-step-text">{step.content}</span>
          </li>
        ),
      )}
    </ol>
  );
}
