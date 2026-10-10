import { useMemo } from "react";

import type { TurnOutcome } from "../../../../../shared/tasks/conversation/chat.js";
import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import { Button } from "../../../../shared/components/button/button";
import { formatUserDateTime } from "../../../../shared/utils/user-date-time.js";
import { CopyButton } from "../../../file-preview/copy-button";
import { formatDuration } from "../../list/duration";
import { formatCost } from "../chat-model";
import { formatOutcomeTimestamp } from "./outcome-timestamp";

type TurnOutcomeRowProps = { outcome: TurnOutcome; response?: string };

/** Where a turn ended: its outcome, how long it ran and what it cost. */
export function TurnOutcomeRow({ outcome, response }: TurnOutcomeRowProps) {
  const controller = useController(),
    { host } = useSnapshot();

  const turnDuration = useMemo(
    () => formatDuration(outcome.runtime_ms),
    [outcome.runtime_ms],
  );

  const turnTimestamp = formatOutcomeTimestamp(outcome.timestamp, host);

  const turnDurationTitle = "Response took " + turnDuration;

  const turnTimestampTitle =
    "Responded on " +
    formatUserDateTime(outcome.timestamp, host, { timeZoneName: undefined });

  return (
    <div
      className="chat-outcome"
      data-outcome={outcome.outcome}
      data-chat-item={outcome.id}
    >
      {outcome.outcome !== "completed" && (
        <div className="chat-note chat-outcome-note" role="separator">
          <span>{outcome.outcome === "failed" ? "Failed" : "Interrupted"}</span>
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
            <time dateTime={outcome.timestamp} title={turnDurationTitle}>
              {turnDuration}
            </time>
          </span>
          {typeof outcome.cost_usd === "number" && (
            <span className="chat-outcome-detail">
              <span aria-hidden="true">·</span>
              <span title="Reported cost">{formatCost(outcome.cost_usd)}</span>
            </span>
          )}
          <span
            className="chat-outcome-detail chat-outcome-timestamp"
            title={turnTimestampTitle}
          >
            <span aria-hidden="true">·</span>
            <span className="chat-outcome-label">{turnTimestamp}</span>
          </span>
        </div>
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
