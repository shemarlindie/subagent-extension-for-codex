import type { TurnOutcome } from "../../../../src/features/tasks/chat.js";
import { Button } from "../../../shared/components/button";
import { useController } from "../../../shared/state/controller-context";
import { formatDuration } from "../list/duration";
import { formatCost } from "./chat-model";

const LABELS: Record<TurnOutcome["outcome"], string> = {
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};

type TurnOutcomeRowProps = { outcome: TurnOutcome };

/** Where a turn ended: its outcome, how long it ran and what it cost. */
export function TurnOutcomeRow({ outcome }: TurnOutcomeRowProps) {
  const controller = useController();

  return (
    <div className="chat-outcome" data-outcome={outcome.outcome}>
      <div className="chat-outcome-line">
        <span className={`dot ${outcome.outcome}`} aria-hidden="true" />
        <span className="chat-outcome-label">
          Turn {outcome.turn} {LABELS[outcome.outcome].toLowerCase()}
        </span>
        <span>· {formatDuration(outcome.runtime_ms)}</span>
        {outcome.cost_usd > 0 && <span>· {formatCost(outcome.cost_usd)}</span>}
        <Button
          variant="text"
          underline
          className="chat-outcome-activity"
          onClick={() => controller.setTab("activity")}
        >
          View activity
        </Button>
      </div>
      {outcome.error && <p className="chat-outcome-error">{outcome.error}</p>}
    </div>
  );
}
