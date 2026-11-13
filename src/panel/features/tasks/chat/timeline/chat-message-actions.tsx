import type { ReactNode } from "react";

import { useSnapshot } from "../../../../app/state/controller-context";
import { Button } from "../../../../shared/components/button/button";
import { CopyButton } from "../../../../shared/components/copy-button/copy-button";
import { Infotip } from "../../../../shared/components/infotip";
import { formatUserDateTime } from "../../../../shared/utils/user-date-time";
import { formatOutcomeTimestamp } from "./outcome-timestamp";

type ChatMessageActionsProps = {
  timestamp: string;
  text?: string;
  copyLabel?: string;
  markUnread?: ReactNode;
};

/** Copy and timestamp controls shared by sent messages and turn responses. */
export function ChatMessageActions({
  timestamp,
  text,
  copyLabel = "Copy message",
  markUnread,
}: ChatMessageActionsProps) {
  const host = useSnapshot((state) => state.host);

  const timestampTitle = formatUserDateTime(timestamp, host, {
    timeZoneName: undefined,
  });

  return (
    <span className="chat-outcome-detail">
      {text !== undefined && (
        <>
          <span className="chat-outcome-tools">
            <CopyButton text={text} label={copyLabel} iconOnly iconSize={10} />
            {markUnread}
          </span>
          <span className="chat-outcome-copy-separator" aria-hidden="true">
            |
          </span>
        </>
      )}
      <Infotip label={timestampTitle}>
        <Button variant="text" className="chat-outcome-timestamp">
          <time dateTime={timestamp}>
            {formatOutcomeTimestamp(timestamp, host)}
          </time>
        </Button>
      </Infotip>
    </span>
  );
}
