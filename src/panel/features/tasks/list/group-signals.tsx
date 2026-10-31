import type { Task } from "../../../app/state/types";
import { UnreadDot } from "../unread/unread-dot";
import { groupSignals } from "./selectors";
import { TaskStatusIcon } from "./task-status-icon";

type GroupSignalsProps = {
  /** The tasks a collapsed group or "Show more" hides. */
  tasks: Task[];
};

/** Flags hidden tasks that need input or have something unread. */
export function GroupSignals({ tasks }: GroupSignalsProps) {
  const { unread, needsInput } = groupSignals(tasks);

  return (
    <>
      {needsInput && <TaskStatusIcon kind="input" label="Needs input" />}
      {unread && <UnreadDot />}
    </>
  );
}
