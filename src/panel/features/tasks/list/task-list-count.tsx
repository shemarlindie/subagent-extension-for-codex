import { useState } from "react";

import { SkeletonShape } from "../../../shared/components/loading-skeleton/loading-skeleton";
import { LoadingSwap } from "../../../shared/components/loading-skeleton/loading-swap";
import type { useTaskSelection } from "./use-task-selection";

type TaskListCountProps = {
  loading: boolean;
  /** How many tasks the list shows, out of `total` when narrowed. */
  shown: number;
  total: number;
  narrowed: boolean;
  selection: ReturnType<typeof useTaskSelection>;
};

/**
 * The list's task count. While selecting, it shows the selection instead,
 * with rows hidden by collapsed groups and what the last action skipped.
 */
export function TaskListCount({
  loading,
  shown,
  total,
  narrowed,
  selection,
}: TaskListCountProps) {
  const selecting = selection.ids !== undefined;
  // Only a switch between the count and the selection rises, not the first render.
  const [mode, setMode] = useState({ selecting, switched: false });

  if (mode.selecting !== selecting) setMode({ selecting, switched: true });

  const count = narrowed ? `${shown} of ${total}` : shown;

  const status = selection.working
    ? "Applying…"
    : [
        `${selection.shownCount + selection.hiddenCount} selected`,
        selection.hiddenCount ? `${selection.hiddenCount} hidden` : "",
        selection.notice ?? "",
      ]
        .filter(Boolean)
        .join(" · ");

  return (
    <span id="count">
      <LoadingSwap
        as="span"
        className="loading-swap-inline"
        loading={loading}
        busy={false}
        skeleton={
          <SkeletonShape
            className={`task-list-count-skeleton${narrowed ? " task-list-count-skeleton-filtered" : ""}`}
          />
        }
      >
        <span
          key={selecting ? "selection" : "count"}
          className={mode.switched ? "motion-rise" : undefined}
        >
          {selecting ? (
            <span className="task-selection-status" role="status">
              {status}
            </span>
          ) : (
            count
          )}
        </span>
      </LoadingSwap>
    </span>
  );
}
