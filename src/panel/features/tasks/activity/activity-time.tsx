import { TooltipWrapper } from "../../../shared/components/tooltip";
import type { UserDateTimePreferences } from "../../../shared/utils/user-date-time";
import { formatUserDateTime } from "../../../shared/utils/user-date-time";
import { formatOutcomeTimestamp } from "../chat/timeline/outcome-timestamp";
import { formatActivityTime } from "./activity-utils";

interface ActivityTimeProps {
  timestamp: string;
  preferences?: UserDateTimePreferences;
  /** Chat's timestamp format, or the compact clock of a group heading. */
  format?: "compact" | "chat";
}

/** The time's tooltip is the full date and time, as Chat's is. */
export function ActivityTime({
  timestamp,
  preferences,
  format = "compact",
}: ActivityTimeProps) {
  const title = formatUserDateTime(timestamp, preferences, {
    timeZoneName: undefined,
  });

  return (
    <TooltipWrapper label={title}>
      <time dateTime={timestamp}>
        {format === "chat"
          ? formatOutcomeTimestamp(timestamp, preferences)
          : formatActivityTime(timestamp, preferences)}
      </time>
    </TooltipWrapper>
  );
}
