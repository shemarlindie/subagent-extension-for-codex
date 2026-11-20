import type { Task } from "../../../app/state/types";
import { UnreadDot } from "../unread/unread-dot";
import { groupSignals } from "./selectors";
import { TaskStatusIcon } from "./task-status-icon";

type GroupSignalsProps = {
  /** The tasks a collapsed group or "Show more" hides. */
  tasks: Task[];
};

/** Flags hidden tasks that need attention or have something unread. */
export function GroupSignals({ tasks }: GroupSignalsProps) {
  const { unread, attention } = groupSignals(tasks);

  return (
    <>
      {attention && (
        <TaskStatusIcon kind={attention.kind} label={attention.label} />
      )}
      {unread && <UnreadDot />}
    </>
  );
}
