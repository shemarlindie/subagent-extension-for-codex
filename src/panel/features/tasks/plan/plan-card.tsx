import { useRef } from "react";

import { planProgress, type TaskPlan } from "../../../../shared/tasks/plan";
import { useSessionState } from "../../../app/state/session/use-session-state";
import { Chevron } from "../../../shared/components/chevron";
import { useAnimatedHeight } from "../../../shared/components/motion/use-animated-height";
import { planCollapseChoice, planCollapsed } from "./plan-collapse";
import { PlanStepIcon, type PlanStepState } from "./plan-step-icon";
import { PlanSteps } from "./plan-steps";

type PlanCardProps = {
  taskId: string;
  plan: TaskPlan;
  /** The worker is at work on its current step. */
  working: boolean;
};

/**
 * The worker's plan above Chat's composer while it has steps left, as Claude
 * Code shows it.
 */
export function PlanCard({ taskId, plan, working }: PlanCardProps) {
  const card = useRef<HTMLElement>(null);

  const [choice, setChoice] = useSessionState(
    "task",
    taskId,
    (state) => state.planCollapse,
  );

  const collapsed = planCollapsed(plan, choice);
  const stale = Boolean(plan.stale);

  // Eases every change that resizes the card: its form, its steps and the caption.
  useAnimatedHeight(
    card,
    `${collapsed}\n${stale}\n${plan.steps.map((s) => s.content).join("\n")}`,
  );

  const { done, total } = planProgress(plan.steps);
  const count = `${done} of ${total}`;
  let state: PlanStepState = working ? "working" : "paused";
  if (stale) state = "stale";

  const toggle = () =>
    setChoice({ planCollapse: planCollapseChoice(plan, !collapsed) });

  const label = `${stale ? "Plan from before your last message" : "Plan"}, ${count} steps done`;

  // The step in progress, or the next one when none is.
  const current = plan.steps.find((s) => s.status !== "completed");

  // One element in both forms, so its height eases between them.
  return (
    <section
      ref={card}
      className="plan-card"
      data-expanded={collapsed ? undefined : ""}
      aria-label={label}
    >
      {collapsed ? (
        <button
          type="button"
          className="plan-card-row"
          aria-expanded={false}
          onClick={toggle}
        >
          <PlanStepIcon status={current?.status ?? "pending"} state={state} />
          <span className="plan-card-current">{current?.content}</span>
          <span className="plan-card-count">
            {count}
            <Chevron size={9} />
          </span>
        </button>
      ) : (
        <>
          <button
            type="button"
            className="plan-card-collapse"
            aria-expanded
            aria-label={`Collapse plan, ${count} steps done`}
            onClick={toggle}
          >
            {count}
            <Chevron size={9} />
          </button>
          {stale && (
            <p className="plan-card-caption">
              Plan from before your last message
            </p>
          )}
          <PlanSteps steps={plan.steps} state={state} />
        </>
      )}
    </section>
  );
}
