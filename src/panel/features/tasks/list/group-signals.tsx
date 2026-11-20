import type { Task } from "../../../app/state/types";
import { UnreadDot } from "../unread/unread-dot";
import { groupSignals } from "./selectors";
import { TaskStatusIcon } from "./task-status-icon";

type GroupSignalsProps = {
  /** The tasks a collapsed group or "Show more" hides. */
  tasks: Task[];
};

/**
 * Flags hidden tasks that have something unread, need attention or are
 * working, in the filters' order.
 */
export function GroupSignals({ tasks }: GroupSignalsProps) {
  const { attention, working, unread } = groupSignals(tasks);

  return (
    <>
      {unread && <UnreadDot />}
      {attention && (
        <TaskStatusIcon kind={attention.kind} label={attention.label} />
      )}
      {working && <TaskStatusIcon kind={working.kind} label={working.label} />}
    </>
  );
}
