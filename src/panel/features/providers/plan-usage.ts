import type { ActivityRateLimitWindow } from "../../../shared/providers/activity/types";
import type { PlanUsage } from "../../../shared/providers/plan-usage";
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
