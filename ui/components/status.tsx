import type { Task } from "../core/types";
import { locked, statusLabel } from "../core/selectors";
import { MotionContent } from "./motion";
export function TaskStatus({ task }: { task: Task }) {
  // A task doing work right now glows; a locked worker is a fault, so its dot holds still.
  const held = locked(task),
    active = task.status === "running" && !task.pending_input && !held;
  return (
    <>
      <span
        className={`dot ${task.status}${active ? " live" : ""}${held ? " locked" : ""}`}
        aria-hidden="true"
      />
      <MotionContent changeKey={statusLabel(task)}>
        {statusLabel(task)}
      </MotionContent>
    </>
  );
}
