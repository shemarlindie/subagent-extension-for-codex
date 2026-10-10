import { useMemo } from "react";

import type { TurnOutcome } from "../../../../../shared/tasks/conversation/chat.js";
import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import { Button } from "../../../../shared/components/button/button";
import { TooltipWrapper } from "../../../../shared/components/tooltip";
import { formatUserDateTime } from "../../../../shared/utils/user-date-time.js";
import { CopyButton } from "../../../file-preview/copy-button";
import { formatDuration } from "../../list/duration";
import { formatCost } from "../chat-model";
import { formatOutcomeTimestamp } from "./outcome-timestamp";

type TurnOutcomeRowProps = { outcome: TurnOutcome; response?: string };

const OUTCOME_LABELS: Record<TurnOutcome["outcome"], string> = {
  completed: "Responded",
  failed: "Failed",
  interrupted: "Interrupted",
};

/** Where a turn ended: its outcome, how long it ran and what it cost. */
export function TurnOutcomeRow({ outcome, response }: TurnOutcomeRowProps) {
  const controller = useController(),
    { host } = useSnapshot();

  const turnDuration = useMemo(
    () => formatDuration(outcome.runtime_ms),
    [outcome.runtime_ms],
  );

  const turnTimestamp = formatOutcomeTimestamp(outcome.timestamp, host);
  const outcomeLabel = OUTCOME_LABELS[outcome.outcome];

  const turnDurationTitle = `${outcomeLabel} after ${turnDuration}`;

  const turnTimestampTitle =
    `${outcomeLabel} on ` +
    formatUserDateTime(outcome.timestamp, host, { timeZoneName: undefined });

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
          <span className="chat-outcome-detail">
            {response !== undefined && (
              <>
                <CopyButton
                  text={response}
                  label="Copy response"
                  iconOnly
                  iconSize={10}
                />
                <span
                  className="chat-outcome-copy-separator"
                  aria-hidden="true"
                >
                  |
                </span>
              </>
            )}
            <TooltipWrapper label={turnDurationTitle}>
              <time dateTime={outcome.timestamp}>{turnDuration}</time>
            </TooltipWrapper>
          </span>
          {typeof outcome.cost_usd === "number" && (
            <span className="chat-outcome-detail">
              <span aria-hidden="true">·</span>
              <TooltipWrapper label="Reported cost">
                {/* The label names the cost, so the value must stay in the accessible name. */}
                <span
                  aria-label={`Reported cost ${formatCost(outcome.cost_usd)}`}
                >
                  {formatCost(outcome.cost_usd)}
                </span>
              </TooltipWrapper>
            </span>
          )}
          <TooltipWrapper label={turnTimestampTitle}>
            <span className="chat-outcome-detail chat-outcome-timestamp">
              <span aria-hidden="true">·</span>
              <span className="chat-outcome-label">{turnTimestamp}</span>
            </span>
          </TooltipWrapper>
        </div>
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
      {outcome.error && <p className="chat-outcome-error">{outcome.error}</p>}
    </div>
  );
}
