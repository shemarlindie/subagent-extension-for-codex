import type { Task } from "../core/types";
import { statusLabel } from "../core/selectors";
export function TaskStatus({ task }: { task: Task }) {
  return (
    <>
      <span className={`dot ${task.status}`} aria-hidden="true" />
      {statusLabel(task)}
    </>
  );
}
