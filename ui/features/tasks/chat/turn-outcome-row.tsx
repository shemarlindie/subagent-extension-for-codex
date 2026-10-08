import { useMemo } from "react";

import type { TurnOutcome } from "../../../../src/features/tasks/chat.js";
import { Button } from "../../../shared/components/button";
import { Icon } from "../../../shared/components/icons";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import { formatUserDateTime } from "../../../shared/utils/user-date-time.js";
import { formatDuration } from "../list/duration";
import { formatCost } from "./chat-model";

type TurnOutcomeRowProps = { outcome: TurnOutcome };

/** Where a turn ended: its outcome, how long it ran and what it cost. */
export function TurnOutcomeRow({ outcome }: TurnOutcomeRowProps) {
  const controller = useController(),
    { host } = useSnapshot();

  const turnDuration = useMemo(
    () => formatDuration(outcome.runtime_ms),
    [outcome.runtime_ms],
  );

  const turnTimestamp = useMemo(
    () => formatUserDateTime(outcome.timestamp, host),
    [outcome.timestamp, host],
  );

  const turnDurationTitle = "Response took " + turnDuration;
  const turnTimestampTitle = "Responded at " + turnTimestamp;

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
        <span className="chat-outcome-line-turn" title={turnTimestampTitle}>
          <Icon name="reply" size={12} />
          <span className="chat-outcome-label">{outcome.turn}</span>
        </span>
        <span>·</span>
        <time dateTime={outcome.timestamp} title={turnDurationTitle}>
          {turnDuration}
        </time>
        {typeof outcome.cost_usd === "number" && (
          <>
            <span>·</span>
            <span title="Reported cost">{formatCost(outcome.cost_usd)}</span>
          </>
        )}
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
