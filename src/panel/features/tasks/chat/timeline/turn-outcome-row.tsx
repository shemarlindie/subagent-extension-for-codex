import { memo, type ReactNode, useMemo } from "react";

import type { TurnOutcome } from "../../../../../shared/tasks/conversation/chat.js";
import { useController } from "../../../../app/state/controller-context";
import { Button } from "../../../../shared/components/button/button";
import { TooltipWrapper } from "../../../../shared/components/tooltip";
import { formatDuration } from "../../list/duration";
import { estimatedCostNote } from "../../shared/estimated-cost";
import { formatCost } from "../chat-model";
import { ChatMessageActions } from "./chat-message-actions";

type TurnOutcomeRowProps = {
  outcome: TurnOutcome;
  response?: string;
  action?: ReactNode;
  /** Beside the copy button, for a response. */
  markUnread?: ReactNode;
};

const OUTCOME_LABELS: Record<TurnOutcome["outcome"], string> = {
  completed: "Responded",
  failed: "Failed",
  interrupted: "Interrupted",
};

/** Where a turn ended: its outcome, how long it ran and what it cost. */
export const TurnOutcomeRow = memo(function TurnOutcomeRow({
  outcome,
  response,
  action,
  markUnread,
}: TurnOutcomeRowProps) {
  const controller = useController();

  const turnDuration = useMemo(
    () => formatDuration(outcome.runtime_ms),
    [outcome.runtime_ms],
  );

  const outcomeLabel = OUTCOME_LABELS[outcome.outcome];

  const turnDurationTitle = `Turn took ${turnDuration}`;

  return (
    <div
      className="chat-outcome"
      data-outcome={outcome.outcome}
      data-chat-item={outcome.id}
    >
      {outcome.outcome !== "completed" && (
        <div className="chat-note chat-outcome-note" role="separator">
          <span>{outcomeLabel}</span>
        </div>
      )}
      <div className="chat-outcome-line">
        <div className="chat-outcome-details">
          <ChatMessageActions
            timestamp={outcome.timestamp}
            text={response}
            copyLabel="Copy response"
            markUnread={markUnread}
          />
          <span className="chat-outcome-detail">
            <span aria-hidden="true">·</span>
            <TooltipWrapper label={turnDurationTitle}>
              <span
                className="chat-outcome-duration"
                aria-label={turnDurationTitle}
              >
                {turnDuration}
              </span>
            </TooltipWrapper>
          </span>
          {typeof outcome.cost_usd === "number" && (
            <span className="chat-outcome-detail">
              <span aria-hidden="true">·</span>
              {/* The tooltip explains the figure, so the trigger names it with its value. */}
              <TooltipWrapper
                label={estimatedCostNote("turn")}
                triggerLabel={`Estimated turn cost ${formatCost(outcome.cost_usd)}`}
              >
                <span>{formatCost(outcome.cost_usd)}</span>
              </TooltipWrapper>
            </span>
          )}
        </div>
        <div className="chat-outcome-actions">
          {action}
          <Button
            variant="text"
            underline
            className="chat-outcome-activity"
            onClick={() =>
              controller.run(() => controller.viewTurnActivity(outcome.turn))
            }
          >
            View activity
          </Button>
        </div>
      </div>
      {outcome.error && <p className="chat-outcome-error">{outcome.error}</p>}
    </div>
  );
});
