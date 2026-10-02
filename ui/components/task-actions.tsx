import type { Task } from "../core/types";
import { terminal, locked } from "../core/selectors";
import { useController, useSnapshot } from "./controller-context";
export function TaskActions({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot(),
    capabilities = state.workers.find(
      (worker) => worker.provider === task.provider,
    )?.capabilities;
  const controls = !terminal(task) && !locked(task);
  const actions = [
    ...(controls
      ? [
          "steer",
          ...(capabilities?.interrupt && task.status !== "interrupted"
            ? ["interrupt"]
            : []),
          ...(task.status === "interrupted" && capabilities?.session_continue
            ? ["continue"]
            : []),
          "cancel",
        ]
      : []),
    ...(["failed", "cancelled"].includes(task.status) && !locked(task)
      ? ["retry"]
      : []),
  ];
  const labels: Record<string, string> = {
    steer: "Steer",
    interrupt: "Interrupt",
    continue: "Continue",
    cancel: "Cancel task",
    retry: "New attempt",
  };
  return (
    <div className="actions">
      {actions.map((action) => (
        <button
          key={action}
          data-action={action}
          disabled={state.busy}
          onClick={() => controller.open({ kind: "control", action, task })}
        >
          {labels[action]}
        </button>
      ))}
      {state.mode === "console" && (
        <button
          id="workspace"
          onClick={() => controller.open({ kind: "workspace", task })}
        >
          Workspace path
        </button>
      )}
      <button
        id="handoff"
        disabled={state.busy}
        onClick={() => controller.open({ kind: "handoff", task })}
      >
        {state.host.canSend
          ? "Bring to Codex"
          : state.mode === "console" && !controller.transport.embedded
            ? "Copy for Codex"
            : "Prepare handoff"}
      </button>
    </div>
  );
}
