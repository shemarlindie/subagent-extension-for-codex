import { formatActivityTime } from "./activity-utils";

export function ActivityTime({ timestamp }: { timestamp: string }) {
  return <time dateTime={timestamp}>{formatActivityTime(timestamp)}</time>;
}
