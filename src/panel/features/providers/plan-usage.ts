import type { ActivityRateLimitWindow } from "../../../core/shared/providers/activity/types";
import type { PlanUsage } from "../../../core/shared/providers/plan-usage";
import {
  formatUserDateTime,
  type UserDateTimePreferences,
} from "../../shared/utils/user-date-time";

/** Share of a window where the warning color starts, as for context usage. */
export const WARNING_SHARE = 0.8;

/** A window's used share as a whole percentage. */
export const percent = (window: ActivityRateLimitWindow) =>
  Math.round(window.utilization * 100);

/**
 * The windows as of `now`, where one whose reset time has passed counts as
 * unused, and the most-used one, which the meter shows.
 */
export function planUsageState(usage: PlanUsage, now: number) {
  const windows = usage.windows.map((window) =>
    window.resetsAt !== undefined && window.resetsAt * 1000 <= now
      ? { id: window.id, label: window.label, utilization: 0 }
      : window,
  );

  const top = windows.reduce((most, window) =>
    window.utilization > most.utilization ? window : most,
  );

  return {
    windows,
    top,
    warning: top.utilization >= WARNING_SHARE,
  };
}

const HOUR_MS = 3_600_000;

/** Each window's length by id, as the usage data gives only its reset time. */
function windowLength(id: string) {
  if (id === "five_hour") return 5 * HOUR_MS;
  if (id.startsWith("seven_day")) return 7 * 24 * HOUR_MS;

  return undefined;
}

/** A window's label under the meter: `5h usage`, `7d usage` or `7d opus`. */
export function windowMeterLabel(id: string) {
  if (id === "five_hour") return "5h usage";
  if (id === "seven_day") return "7d usage";
  // Per-model windows, such as seven_day_opus, drop "usage" to stay short.
  const model = id.match(/^seven_day_(.+)$/)?.[1];
  if (model) return `7d ${model}`;

  return "usage";
}

/** Time left, rounded up to the minute: `3d 4h`, `1h 12m` or `5m`. */
export function formatTimeLeft(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days) return `${days}d ${hours % 24}h`;
  if (hours) return `${hours}h ${minutes % 60}m`;

  return `${minutes}m`;
}

/**
 * How much of a window's time has passed, from 0 to 1, which usage can be
 * compared against for pace. Undefined when the length or reset is unknown.
 */
export function elapsedShare(window: ActivityRateLimitWindow, now: number) {
  const length = windowLength(window.id);
  if (!length || window.resetsAt === undefined) return undefined;
  const left = window.resetsAt * 1000 - now;

  return Math.min(Math.max(1 - left / length, 0), 1);
}

/** When the next window resets, in epoch milliseconds, if one is still ahead. */
export function nextReset(usage: PlanUsage | undefined, now: number) {
  const ahead = (usage?.windows ?? [])
    .map((window) => (window.resetsAt ?? 0) * 1000)
    .filter((time) => time > now);

  return ahead.length ? Math.min(...ahead) : undefined;
}

const sameDay = (
  a: number,
  b: number,
  preferences?: UserDateTimePreferences,
) => {
  const day = (time: number) =>
    formatUserDateTime(new Date(time).toISOString(), preferences, {
      hour: undefined,
      minute: undefined,
      second: undefined,
      timeZoneName: undefined,
    });

  return day(a) === day(b);
};

/** A time of day, with the weekday unless it falls on the day of `now`. */
export function formatPlanTime(
  time: number,
  now: number,
  preferences?: UserDateTimePreferences,
) {
  return formatUserDateTime(new Date(time).toISOString(), preferences, {
    year: undefined,
    month: undefined,
    day: undefined,
    second: undefined,
    timeZoneName: undefined,
    ...(sameDay(time, now, preferences) ? {} : { weekday: "short" }),
  });
}
