import { useEffect, useState } from "react";

import type { ActivityRateLimitWindow } from "../../../shared/providers/activity/types";
import type { PlanUsage } from "../../../shared/providers/plan-usage";
import { titleCase } from "../../../shared/text";
import { useController, useSnapshot } from "../../app/state/controller-context";
import { Infotip } from "../../shared/components/infotip";
import { useLoadingSkeletonDelay } from "../../shared/components/loading-skeleton/loading-skeleton";
import { LOADING_SKELETON_CONFIG } from "../../shared/components/loading-skeleton/loading-skeleton-config";
import { ProgressBar } from "../../shared/components/progress-bar/progress-bar";
import {
  elapsedShare,
  formatPlanTime,
  formatTimeLeft,
  nextReset,
  percent,
  planUsageState,
  WARNING_SHARE,
  windowMeterLabel,
} from "./plan-usage";

/**
 * The current time, taken again when a read arrives, when a window resets and,
 * with `everyMinute`, each minute for a countdown.
 */
function useResetClock(usage?: PlanUsage, everyMinute = false) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => setNow(Date.now()), [usage]);

  useEffect(() => {
    if (!everyMinute) return;

    const timer = setInterval(() => setNow(Date.now()), 60_000);

    return () => clearInterval(timer);
  }, [everyMinute]);

  // Runs again after each reset, so it waits for the one after.
  useEffect(() => {
    const next = nextReset(usage, now);
    if (next === undefined) return;

    const timer = setTimeout(() => setNow(Date.now()), next - Date.now());

    return () => clearTimeout(timer);
  }, [usage, now]);

  return now;
}

/**
 * How much of the plan's usage limits the account has used, as the most-used
 * window's percentage over its short name, or over the time until it resets
 * once used up. Its note lists every window. Nothing shows until a read finds
 * plan limits, or when the setting hides it.
 */
export function PlanUsageMeter() {
  const { planUsage, host, panelSettings } = useSnapshot([
    "planUsage",
    "host",
    "panelSettings",
  ]);

  const controller = useController();

  // A used-up window counts down to its reset.
  const now = useResetClock(
    planUsage,
    planUsage?.windows.some((window) => window.utilization >= 1),
  );

  const [refreshing, setRefreshing] = useState(false);
  // A read that ends quickly shows no change, as loading placeholders do.
  const showRefreshing = useLoadingSkeletonDelay(refreshing);

  if (!panelSettings.plan_usage_meter || !planUsage?.windows.length) {
    return null;
  }

  const { windows, top, warning } = planUsageState(planUsage, now);
  const time = (at: number) => formatPlanTime(at, now, host).toLowerCase();

  const reset = (window: ActivityRateLimitWindow) =>
    window.resetsAt === undefined
      ? undefined
      : `resets ${time(window.resetsAt * 1000)}`;

  const label =
    top.utilization >= 1 && top.resetsAt !== undefined
      ? `in ${formatTimeLeft(top.resetsAt * 1000 - now)}`
      : windowMeterLabel(top.id);

  const plan = planUsage.plan ? `${titleCase(planUsage.plan)} plan` : "Plan";

  // Opening reads again, which the service limits to every 10 seconds.
  const refresh = (open: boolean) => {
    if (!open || refreshing) return;

    setRefreshing(true);
    const started = Date.now();

    // A failed read keeps the last value, which the service logs.
    void controller
      .tool("app_refresh_plan_usage", {})
      .catch(() => undefined)
      .then(() => {
        const { delay, minimumVisible } = LOADING_SKELETON_CONFIG;
        const elapsed = Date.now() - started;

        // Once shown, "refreshing" stays long enough to read.
        const hold =
          elapsed > delay ? Math.max(delay + minimumVisible - elapsed, 0) : 0;

        setTimeout(() => setRefreshing(false), hold);
      });
  };

  return (
    <Infotip
      onOpenChange={refresh}
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
            <span className="muted">
              {" · "}
              {showRefreshing
                ? "refreshing…"
                : `updated ${time(planUsage.read_at)}`}
            </span>
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
        <span aria-hidden="true" className="plan-usage-meter-label">
          {label}
        </span>
      </button>
    </Infotip>
  );
}
