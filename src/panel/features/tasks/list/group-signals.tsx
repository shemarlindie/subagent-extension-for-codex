import type { ReactNode } from "react";

import type { Task } from "../../../app/state/types";
import { Presence } from "../../../shared/components/motion/presence";
import { TooltipWrapper } from "../../../shared/components/tooltip";
import { UnreadDot } from "../unread/unread-dot";
import { groupSignals } from "./selectors";
import { TaskStatusIcon } from "./task-status-icon";

type GroupSignalsProps = {
  /** The tasks a collapsed group or "Show more" hides. */
  tasks: Task[];
  /**
   * Names each dot on hover. A collapsed header's dots hide on hover, where
   * the project menu takes their place, so only "Show more" names them.
   */
  tooltips?: boolean;
};

type SignalProps = {
  show: boolean;
  label: string;
  tooltip?: boolean;
  children: ReactNode;
};

/** Joins states as "a, b and c". */
const listed = (states: string[]) =>
  states.length > 1
    ? `${states.slice(0, -1).join(", ")} and ${states.at(-1)}`
    : (states[0] ?? "");

// The phrase after the dots speaks for them, so screen readers skip each dot.
function Signal({ show, label, tooltip, children }: SignalProps) {
  const dot = (
    <span className="group-signal" aria-hidden="true">
      {children}
    </span>
  );

  return (
    <Presence show={show} as="span" variant="fold">
      {tooltip ? <TooltipWrapper label={label}>{dot}</TooltipWrapper> : dot}
    </Presence>
  );
}

/**
 * Flags hidden tasks that have something unread, need attention or are
 * working, in the filters' order. Each dot folds in and out, so its neighbours
 * slide over. Screen readers hear one phrase in place of the dots, such as
 * ", including unread and working".
 */
export function GroupSignals({ tasks, tooltips }: GroupSignalsProps) {
  const { attention, working, unread } = groupSignals(tasks);

  const states = [
    unread && "unread",
    attention &&
      (attention.kind === "paused"
        ? "waiting for a rate limit"
        : "needing input"),
    working && "working",
  ].filter((state) => typeof state === "string");

  return (
    <>
      <Signal show={unread} label="Unread" tooltip={tooltips}>
        <UnreadDot />
      </Signal>
      <Signal
        show={Boolean(attention)}
        label={attention?.label ?? ""}
        tooltip={tooltips}
      >
        {attention && (
          <TaskStatusIcon
            kind={attention.kind}
            label={attention.label}
            decorative
          />
        )}
      </Signal>
      <Signal
        show={Boolean(working)}
        label={working?.label ?? ""}
        tooltip={tooltips}
      >
        {working && (
          <TaskStatusIcon
            kind={working.kind}
            label={working.label}
            decorative
          />
        )}
      </Signal>
      {states.length > 0 && (
        <span className="visually-hidden">, including {listed(states)}</span>
      )}
    </>
  );
}
