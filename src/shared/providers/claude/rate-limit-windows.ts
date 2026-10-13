import type { ActivityRateLimitWindow } from "../activity/types.js";
import type { ClaudeRateLimitWindowInfo } from "./events.js";

const labels: Record<
  NonNullable<ClaudeRateLimitWindowInfo["rateLimitType"]>,
  string
> = {
  five_hour: "5-hour window",
  seven_day: "7-day window",
  seven_day_opus: "7-day Opus window",
  seven_day_sonnet: "7-day Sonnet window",
  seven_day_overage_included: "7-day included-model window",
  overage: "Overage",
};

/** Converts Claude's rate-limit metadata into the provider-neutral window shape. */
export function claudeRateLimitWindows(
  info: ClaudeRateLimitWindowInfo,
): ActivityRateLimitWindow[] {
  const id = info.rateLimitType;
  const { utilization, resetsAt: resetTime } = info;

  if (
    id === undefined ||
    id === "overage" ||
    typeof utilization !== "number" ||
    !Number.isFinite(utilization)
  ) {
    return [];
  }

  const resetsAt =
    typeof resetTime === "number" &&
    Number.isFinite(new Date(resetTime * 1000).getTime())
      ? resetTime
      : undefined;

  return [{ id, label: labels[id], utilization, resetsAt }];
}
