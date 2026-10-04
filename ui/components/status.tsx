import type { Task } from "../core/types";
import { statusLabel } from "../core/selectors";
export function TaskStatus({ task, live }: { task: Task; live?: boolean }) {
  return (
    <>
      <span
        className={`dot ${task.status}${live ? " live" : ""}`}
        aria-hidden="true"
      />
      {statusLabel(task)}
    </>
  );
}
