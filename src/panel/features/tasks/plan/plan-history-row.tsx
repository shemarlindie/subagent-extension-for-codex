import { Collapsible } from "@base-ui/react/collapsible";
import { memo, useRef } from "react";

import type { ChatPlan } from "../../../../shared/tasks/conversation/chat.js";
import { planProgress } from "../../../../shared/tasks/plan.js";
import { Chevron } from "../../../shared/components/chevron";
import { useAnimatedHeight } from "../../../shared/components/motion/use-animated-height";
import { PlanStepIcon } from "./plan-step-icon";
import { PlanSteps } from "./plan-steps";

type PlanHistoryRowProps = {
  item: ChatPlan;
  /** Expands a new row into a conversation that is already showing. */
  arriving?: boolean;
};

/** A plan that left the pinned card, folded to one line in Chat. */
export const PlanHistoryRow = memo(function PlanHistoryRow({
  item,
  arriving,
}: PlanHistoryRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  useAnimatedHeight(ref, item.id, arriving);
  const { done, total } = planProgress(item.steps);

  return (
    <Collapsible.Root
      ref={ref}
      className="plan-card plan-history"
      data-chat-item={item.id}
    >
      <Collapsible.Trigger className="plan-card-row">
        <PlanStepIcon
          status={done === total ? "completed" : "in_progress"}
          state="paused"
        />
        <span className="plan-card-current">
          Plan · {done} of {total} {total === 1 ? "step" : "steps"} done
        </span>
        <Chevron size={9} />
      </Collapsible.Trigger>
      <Collapsible.Panel className="collapse-panel">
        <div className="plan-history-steps">
          <PlanSteps steps={item.steps} state="paused" />
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
});
