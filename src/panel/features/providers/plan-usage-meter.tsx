import { useEffect, useState } from "react";

import type { ActivityRateLimitWindow } from "../../../shared/providers/activity/types";
import type { PlanUsage } from "../../../shared/providers/plan-usage";
import { titleCase } from "../../../shared/text";
import { useSnapshot } from "../../app/state/controller-context";
import { Infotip } from "../../shared/components/infotip";
import { ProgressBar } from "../../shared/components/progress-bar/progress-bar";
import {
  elapsedShare,
  formatPlanTime,
  nextReset,
  percent,
  planUsageState,
  WARNING_SHARE,
} from "./plan-usage";

/** The current time, taken again when a read arrives and when a window resets. */
function useResetClock(usage?: PlanUsage) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const next = nextReset(usage, Date.now());
    if (next === undefined) return;

    const timer = setTimeout(() => setNow(Date.now()), next - Date.now());

    return () => clearTimeout(timer);
  }, [usage]);

  return now;
}

/**
 * How much of the plan's usage limits the account has used, as the most-used
 * window's percentage over a bar. Its note lists every window. Nothing shows
 * until a read finds plan limits.
 */
export function PlanUsageMeter() {
  const { planUsage, host } = useSnapshot(["planUsage", "host"]);
  const now = useResetClock(planUsage);

  if (!planUsage?.windows.length) return null;

  const { windows, top, warning } = planUsageState(planUsage, now);
  const time = (at: number) => formatPlanTime(at, now, host).toLowerCase();

  const reset = (window: ActivityRateLimitWindow) =>
    window.resetsAt === undefined
      ? undefined
      : `resets ${time(window.resetsAt * 1000)}`;

  const plan = planUsage.plan ? `${titleCase(planUsage.plan)} plan` : "Plan";

  return (
    <Infotip
      triggerLabel={[
        `Plan usage: ${percent(top)}% ${top.label.toLowerCase()}`,
        reset(top),
      ]
        .filter(Boolean)
        .join(", ")}
      label={
        <>
          <span className="plan-usage-tooltip-title">
            <strong>{plan} usage</strong>
            <span className="muted"> · updated {time(planUsage.read_at)}</span>
          </span>
          <span className="plan-usage-tooltip-rows">
            {windows.map((window) => (
              <span
                key={window.id}
                data-warning={window.utilization >= WARNING_SHARE || undefined}
              >
                <span>{percent(window)}%</span>
                <span>
                  {window.label.toLowerCase()}
                  {window.resetsAt !== undefined && (
                    <span className="muted">, {reset(window)}</span>
                  )}
                </span>
                <ProgressBar
                  value={window.utilization}
                  marker={elapsedShare(window, now)}
                />
              </span>
            ))}
          </span>
        </>
      }
    >
      <button
        type="button"
        id="plan-usage"
        className="text-button plan-usage-meter"
        data-warning={warning || undefined}
      >
        {/* The trigger's accessible name already says this. */}
        <span aria-hidden="true" data-long={percent(top) >= 100 || undefined}>
          {percent(top)}%
        </span>
        <ProgressBar value={top.utilization} />
      </button>
    </Infotip>
  );
}
