import { Collapsible } from "@base-ui/react/collapsible";
import { useLayoutEffect, useRef } from "react";

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
  /** Called after the card changes size, so Chat can stay at its latest message. */
  onResize?: () => void;
};

/** The worker's plan above Chat's composer while it has steps left. */
export function PlanCard({ taskId, plan, working, onResize }: PlanCardProps) {
  const card = useRef<HTMLDivElement>(null);

  const [choice, setChoice] = useSessionState(
    "task",
    taskId,
    (state) => state.planCollapse,
  );

  const collapsed = planCollapsed(plan, choice);
  const stale = Boolean(plan.stale);

  const shape = `${collapsed}\n${plan.steps.map((s) => s.content).join("\n")}`;
  const lastShape = useRef(shape);

  // Eases changes to the open steps. The panel eases its own opening and closing,
  // so the card measures no change then.
  useAnimatedHeight(card, shape);

  useLayoutEffect(() => {
    // Measuring a shorter card can clamp Chat before the animation starts.
    if (shape !== lastShape.current) onResize?.();
    lastShape.current = shape;
  }, [shape, onResize]);

  const { done, total } = planProgress(plan.steps);
  const count = `${done} of ${total}`;
  let state: PlanStepState = working ? "working" : "paused";
  if (stale) state = "stale";

  const title = stale ? "Plan from before your last message" : "Plan";
  const label = `${title}, ${count} steps done`;

  // The step in progress, or the next one when none is. Catching up with
  // `start` can leave earlier steps pending.
  const current =
    plan.steps.find((s) => s.status === "in_progress") ??
    plan.steps.find((s) => s.status === "pending");

  // Collapsed, the row shows the current step, unless the plan is stale.
  const showStep = collapsed && !stale;

  // One row in both forms, so the count and caret stay put and focus stays on it.
  // Only the label fades between forms.
  return (
    <Collapsible.Root
      ref={card}
      className="plan-card"
      role="region"
      aria-label={label}
      open={!collapsed}
      onOpenChange={(open) =>
        setChoice({ planCollapse: planCollapseChoice(plan, !open) })
      }
    >
      <Collapsible.Trigger className="plan-card-row">
        {showStep ? (
          <span key="step" className="plan-card-label motion-swap">
            <PlanStepIcon status={current?.status ?? "pending"} state={state} />
            <span className="plan-card-current">{current?.content}</span>
          </span>
        ) : (
          <span key="plan" className="plan-card-label motion-swap">
            <span className="plan-card-current plan-card-title">{title}</span>
          </span>
        )}
        <span className="plan-card-count">
          {count}
          <Chevron size={9} />
        </span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="collapse-panel">
        <div className="plan-card-steps">
          <PlanSteps steps={plan.steps} state={state} />
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
