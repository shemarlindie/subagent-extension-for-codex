import type { PlanUsage } from "../../../src/core/shared/providers/plan-usage";

/** The plan usage states the dev host offers. */
export const previewPlanUsageStates = {
  none: "None",
  normal: "Normal",
  close: "Getting close",
  limited: "Limit reached",
} as const;

export type PreviewPlanUsageState = keyof typeof previewPlanUsageStates;

const minute = 60;

/** Plan usage as the service reads it, with resets relative to now. */
export function previewPlanUsage(
  state: PreviewPlanUsageState = "normal",
): PlanUsage | undefined {
  if (state === "none") return undefined;

  const now = Math.floor(Date.now() / 1000);
  const session = { normal: 0.42, close: 0.86, limited: 1 }[state];

  return {
    plan: "pro",
    windows: [
      {
        id: "five_hour",
        label: "5-hour window",
        utilization: session,
        resetsAt: now + 132 * minute,
      },
      {
        id: "seven_day",
        label: "7-day window",
        utilization: state === "normal" ? 0.18 : 0.64,
        resetsAt: now + 5 * 24 * 60 * minute,
      },
    ],
    read_at: Date.now() - 2 * minute * 1000,
  };
}
