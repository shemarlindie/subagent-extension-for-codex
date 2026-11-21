import { useEffect, useState } from "react";

import type { PlanUsage } from "../../../shared/providers/plan-usage";
import { titleCase } from "../../../shared/text";
import { useSnapshot } from "../../app/state/controller-context";
import { Infotip } from "../../shared/components/infotip";
import { ProgressRing } from "../../shared/components/progress-ring/progress-ring";
import {
  formatPlanTime,
  nextReset,
  percent,
  planUsageState,
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
 * How much of the plan's usage limits the account has used, as a ring and
 * the most-used window's percentage, beside the header's status. Its note
 * lists every window. Nothing shows until a read finds plan limits.
 */
export function PlanUsageMeter() {
  const { planUsage, host } = useSnapshot(["planUsage", "host"]);
  const now = useResetClock(planUsage);

  if (!planUsage?.windows.length) return null;

  const { windows, top, limited, warning } = planUsageState(planUsage, now);

  const reset = (window: { resetsAt?: number }) =>
    window.resetsAt === undefined
      ? undefined
      : `Resets ${formatPlanTime(window.resetsAt * 1000, now, host)}`;

  const topReset = reset(top);
  const value = limited && topReset ? topReset : `${percent(top)}%`;

  const status = limited
    ? `Limit reached for the ${top.label}`
    : `${planUsage.plan ? `${titleCase(planUsage.plan)} plan` : "Plan"} usage`;

  const triggerLabel = limited
    ? `Plan usage: ${status}${topReset ? `. ${topReset}` : ""}`
    : `Plan usage: ${top.label} ${percent(top)}% used`;

  return (
    <Infotip
      triggerLabel={triggerLabel}
      label={
        <>
          <span className="plan-usage-tooltip-status">{status}</span>
          <span className="plan-usage-tooltip-rows">
            {windows.map((window) => (
              <span key={window.id}>
                <span>{window.label}</span>
                <span>{percent(window)}%</span>
                <span>{reset(window)}</span>
              </span>
            ))}
          </span>
          <span className="plan-usage-tooltip-note">
            Includes your other Claude use. As of{" "}
            {formatPlanTime(planUsage.read_at, now, host)}.
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
        <ProgressRing value={top.utilization} />
        {/* The trigger's accessible name already says this. */}
        <span className="plan-usage-meter-value" aria-hidden="true">
          {value}
        </span>
      </button>
    </Infotip>
  );
}
