import type { ActivityRateLimitWindow } from "../activity/types.js";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const labels: Record<string, string> = {
  five_hour: "5-hour window",
  seven_day: "7-day window",
  seven_day_opus: "7-day Opus window",
  seven_day_sonnet: "7-day Sonnet window",
  seven_day_overage_included: "7-day included-model window",
};

/** Shared with the compatibility reader for events stored before normalization. */
export function claudeRateLimitWindows(
  value: unknown,
): ActivityRateLimitWindow[] {
  const info = record(value);
  const windows = new Map(Object.entries(record(info.unifiedWindows)));
  if (
    typeof info.rateLimitType === "string" &&
    !windows.has(info.rateLimitType)
  )
    windows.set(info.rateLimitType, info);

  return [...windows.entries()].flatMap(([id, value]) => {
    const window = record(value);
    if (
      id === "overage" ||
      typeof window.utilization !== "number" ||
      !Number.isFinite(window.utilization)
    )
      return [];

    const resetsAt =
      typeof window.resetsAt === "number" &&
      Number.isFinite(new Date(window.resetsAt * 1000).getTime())
        ? window.resetsAt
        : undefined;

    return [
      {
        id,
        label: labels[id] ?? id.replaceAll("_", " "),
        utilization: window.utilization,
        resetsAt,
      },
    ];
  });
}
