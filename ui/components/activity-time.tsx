import { formatActivityTime } from "../utils/activity";

export function ActivityTime({ timestamp }: { timestamp: string }) {
  return <time dateTime={timestamp}>{formatActivityTime(timestamp)}</time>;
}
