import type { Task } from "../../../app/state/types";
import { Presence } from "../../../shared/components/motion/presence";
import { UnreadDot } from "../unread/unread-dot";
import { groupSignals } from "./selectors";
import { TaskStatusIcon } from "./task-status-icon";

type GroupSignalsProps = {
  /** The tasks a collapsed group or "Show more" hides. */
  tasks: Task[];
};

/**
 * Flags hidden tasks that have something unread, need attention or are
 * working, in the filters' order. Each dot folds in and out, so its neighbours
 * slide over.
 */
export function GroupSignals({ tasks }: GroupSignalsProps) {
  const { attention, working, unread } = groupSignals(tasks);

  return (
    <>
      <Presence show={unread} as="span" variant="fold">
        <UnreadDot />
      </Presence>
      <Presence show={Boolean(attention)} as="span" variant="fold">
        {attention && (
          <TaskStatusIcon kind={attention.kind} label={attention.label} />
        )}
      </Presence>
      <Presence show={Boolean(working)} as="span" variant="fold">
        {working && (
          <TaskStatusIcon kind={working.kind} label={working.label} />
        )}
      </Presence>
    </>
  );
}
