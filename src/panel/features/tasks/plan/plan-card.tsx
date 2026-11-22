import { useRef } from "react";

import { planProgress } from "../../../../shared/tasks/plan";
import { useSessionState } from "../../../app/state/session/use-session-state";
import type { Task } from "../../../app/state/types";
import { Chevron } from "../../../shared/components/chevron";
import { useAnimatedHeight } from "../../../shared/components/motion/use-animated-height";
import { planCollapseChoice, planCollapsed } from "./plan-collapse";
import { PlanStepIcon } from "./plan-step-icon";
import { PlanSteps } from "./plan-steps";

type PlanCardProps = { task: Task };

/**
 * The worker's latest plan above Chat's composer, as Claude Code shows it.
 * It stays after the turn ends, until the worker clears or replaces it.
 */
export function PlanCard({ task }: PlanCardProps) {
  const card = useRef<HTMLElement>(null);

  const [choice, setChoice] = useSessionState(
    "task",
    task.id,
    (state) => state.planCollapse,
  );

  const plan = task.plan;
  const collapsed = plan ? planCollapsed(plan, choice) : false;
  useAnimatedHeight(card, collapsed);
  if (!plan?.steps.length) return null;

  const { done, total } = planProgress(plan.steps);
  const count = `${done} of ${total}`;
  const stale = Boolean(plan.stale);
  const spin = task.status === "running";

  const toggle = () =>
    setChoice({ planCollapse: planCollapseChoice(plan, !collapsed) });

  const label = `${stale ? "Plan from before your last message" : "Plan"}, ${
    done === total ? `all ${total} steps done` : `${count} steps done`
  }`;

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
          data-done={current ? undefined : ""}
          aria-expanded={false}
          onClick={toggle}
        >
          <PlanStepIcon
            status={current?.status ?? "completed"}
            stale={stale}
            spin={spin}
          />
          <span className="plan-card-current">
            {current?.content ??
              (total === 1 ? "Step done" : `All ${total} steps done`)}
          </span>
          {current && <span className="plan-card-count">{count}</span>}
          <Chevron size={9} />
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
          <PlanSteps steps={plan.steps} stale={stale} spin={spin} />
        </>
      )}
    </section>
  );
}
